// Import modules
const express = require('express');
const compression = require('compression');
const bodyParser = require('body-parser');
const marked = require('marked');
const basicAuth = require('express-basic-auth');
const cookieParser = require('cookie-parser');
const parser = new (require('rss-parser'))();
const RSS = require('rss');

// Import config
const config = require('./config.json');
const directory = require('./directory.json');

const crud = require('@bibliobone/mongodb-crud').bind(config.mongodbURI, config.dbName);

const app = express();

// Set up middleware
app.use(compression());
app.use('/admin/', basicAuth({ users: config.admins, challenge: true }));
app.use(cookieParser());
app.use(express.static('static'));
app.use('/assets/', express.static('assets'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(bodyParser.json());
app.use((request, response, next) => {
  if (directory[request.path] !== undefined && request.method.toUpperCase() === 'GET') {
    return response.render(directory[request.path], {
      parameters: request.query,
      config,
      cookies: request.cookies,
    });
  }

  return next();
});
app.set('view engine', 'pug');
app.set('views', './templates');

// Admin router
const adminRouter = require('./routers/admin');

app.use('/admin/', adminRouter);

// Projects homepage
app.get('/projects/', async (request, response) => {
  let projects = [];
  await crud.findMultipleDocuments('projects', {}).then((result) => {
    projects = result;
  });
  response.render('projects.pug', {
    projects,
    marked,
    cookies: request.cookies,
    config
  });
});

// Writing homepage
app.get('/writing/', async (request, response) => {
  let writing = [];
  await crud.findMultipleDocuments('writing', {}).then((result) => {
    writing = result;
  });

  return response.render('writing.pug', {
    writing,
    marked,
    config,
    cookies: request.cookies
  });
});

app.get('/writing/:workId/', async (request, response) => {
  let work = {};
  await crud.findDocument('writing', { id: request.params.workId }).then((result) => {
    work = result;
  });

  if (work === null || work.published === false || work.published.website !== true) {
    return response.render('errors/404.pug', { cookies: request.cookies });
  }

  return response.render('writingwork.pug', {
    work,
    title: work.title,
    metaDescription: marked.parse(work.synopsis.split('\n\n')[0]).replace(/(<([^>]+)>)/ig, ''),
    cookies: request.cookies,
    marked,
    config,
  });
});


// Change color theme
const supportedThemes = ['dark', 'light'];
app.get('/settings/theme/:theme', async (request, response) => {
  if (supportedThemes.indexOf(request.params.theme) === -1) return response.status(404).end();

  response.cookie('theme', request.params.theme);
  if (request.query.refresh === 'false') return response.status(204).end();
  else return response.redirect(302, request.headers['referer']);
});

// Change font family
const supportedFontFamilies = ['serif', 'sans', 'monospace'];
app.get('/settings/font/:fontFamily', async (request, response) => {
  if (supportedFontFamilies.indexOf(request.params.fontFamily) === -1) return response.status(404).end();

  response.cookie('fontFamily', request.params.fontFamily);
  if (request.query.refresh === 'false') return response.status(204).end();
  else return response.redirect(302, request.headers['referer']);
});

// Change size
app.get('/settings/size/:size', async (request, response) => {
  const size = parseInt(request.params.size);
  if (size < 1 || size > 5) return response.status(404).end();

  response.cookie('size', size);
  if (request.query.refresh === 'false') return response.status(204).end();
  else return response.redirect(302, request.headers['referer']);
});

// Customized RSS
const feedLinks = {
  swec: 'https://seewitheyesclosed.com/feed/',
  verbguac: 'https://verboseguacamole.com/feed/',
  masto: 'https://fosstodon.org/users/benjaminhollon.rss'
}
const feedCaches = {
  swec: false,
  verbguac: false,
  masto: false
};

async function updateFeeds() {
  for (var f of Object.keys(feedCaches)) {
    if (feedCaches[f] === false) {
      feedCaches[f] = (await parser.parseURL(feedLinks[f])).items;

      setTimeout((async (f) => {
        feedCaches[f] = false;
      }).bind(this, f), Math.floor((Math.random() /* (5 * 1000 * 60)*/) + (/*5 */ 1000 * 60)));
    }
  }
}

try {
  updateFeeds();
} catch(err) {
  console.warn(err);
}

app.get('/feed/', async (request, response) => {
  await updateFeeds();

  const items = (request.query.from || 'swec,verbguac')
    .split(',')
    .map((f) => feedCaches[f])
    .flat()
    .sort((a, b) => {
      return (new Date(b.pubDate)) - (new Date(a.pubDate))
    })
    .map(i => {
      const newI = {...i};

      newI.description = i.content;
      newI.date = new Date(i.pubDate);

      return newI;
    });

  const feed = new RSS({
    title: 'Feeds from Benjamin Hollon',
    description: 'A customized aggregation of feeds from multiple sites by Benjamin Hollon.',
    feed_url: request.protocol + '://' + request.hostname + request.url,
    site_url: request.protocol + '://' + request.hostname,
    managingEditor: 'Benjamin Hollon',
    webMaster: 'Benjamin Hollon',
    copyright: 'Verbose Guacamole: CC BY-NC 4.0\nSee With Eyes Closed: CC BY-SA 4.0\nMastodon: CC BY-SA 4.0',
    language: 'en',
  });

  for (const item of items) {
    feed.item(item);
  }

  response.setHeader('Content-type', 'application/xml+rss');
  response.end(feed.xml());
  //response.json(items);
});

// Errors
app.use((request, response) => {
  response.status(404);
  response.render('errors/404.pug', { cookies: request.cookies, config });
});

// Listen on port from config.json
app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
