// Import modules
const express = require('express');
const compression = require('compression');
const bodyParser = require('body-parser');
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
      cookies:
      request.cookies,
    });
  }

  return next();
});
app.set('view engine', 'pug');
app.set('views', './templates');

// Projects homepage
app.get('/projects/', async (request, response) => {
  let projects = [];
  await crud.findMultipleDocuments('projects', {}).then((result) => {
    projects = result;
  });
  response.render('projects.pug', {
    projects,
    cookies: request.cookies,
    config
  });
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
        try {
          updateFeeds();
        } catch(err) {
          console.warn(err);
        }
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

  const items = request.query.from
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
    managingEditor: 'Benjamin Hollon <br3zls68l@mozmail.com>',
    webMaster: 'Benjamin Hollon <br3zls68l@mozmail.com>',
    copyright: 'Verbose Guacamole: CC BY-NC 4.0\nSee With Eyes Closed: CC BY-SA 4.0\nMastodon: Unknown. Research needed.',
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
