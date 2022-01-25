// Import modules
const express = require('express');
const compression = require('compression');
const bodyParser = require('body-parser');
const marked = require('marked');
const basicAuth = require('express-basic-auth');
const cookieParser = require('cookie-parser');
const {encode} = require('html-entities');
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

// Feeds
app.get('/musings/feed/', async (request, response) => {
  const appendComplete = `\n\n---\n\nThis article was first published on [the Musings website](https://${request.hostname}/musings/), but the full article was generously provided to you via RSS. Please consider [visiting the article on the site](https://${request.hostname}/musings/[[ID]]/) to leave feedback or view similar See With Eyes Closed articles.`;

  const appendSummary = `\n\n---\n\nThis article has elements in it that cannot be sent through RSS. You can [view the full article](https://${request.hostname}/musings/[[ID]]/) on [the Musings website](https://${request.hostname}/musings/).`;

  let articles = [];

  await crud.findMultipleDocuments('musings', {}).then((result) => {
    articles = result.filter((value) => new Date(value.date) <= new Date());
  });

  articles.sort((a, b) => new Date(b.date) - new Date(a.date));

  const feed = articles
    .slice(0, 15)
    .filter(article => new Date(article.date) <= Date.now())
    .map((article) => {
      const date = new Date(article.date);
      if (article.content.indexOf('<script') === -1 && article.content.indexOf('<style') === -1) {
        return `<item>
          <title>${article.title}</title>
          <link>https://${request.hostname}/articles/${article.id}/</link>
          <guid isPermaLink="false">${article._id.toString()}</guid>
          <pubDate>${date.toUTCString()}</pubDate>
          <description>${encode(marked.parse(article.content + appendComplete.replace('[[ID]]', article.id)), {mode: 'nonAsciiPrintable', level: 'xml'})}</description>
        </item>`;
      }

      return `<item>
        <title>${article.title}</title>
        <link>https://${request.hostname}/articles/${article.id}/</link>
        <guid isPermaLink="false">${article._id.toString()}</guid>
        <pubDate>${date.toUTCString()}</pubDate>
        <description>${encode(marked.parse(article.summary + appendSummary.replace('[[ID]]', article.id)), {mode: 'nonAsciiPrintable', level: 'xml'})}</description>
      </item>`;
    });

  response.setHeader('Content-type', 'application/rss+xml');
  response.send(
    `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
  <title>Musings</title>
  <description>A personal blog by Benjamin Hollon.</description>
  <language>en-us</language>
  <copyright>© Benjamin Hollon ${(new Date()).getFullYear()}. Content licensed under CC BY-SA 4.0.</copyright>
  <link>https://${request.hostname}/</link>${
  feed.join('')
}
  </channel>
  </rss>`,
  );
});

// Customized RSS
const feedLinks = {
  swec: 'https://seewitheyesclosed.com/feed/',
  musings: 'https://benjaminhollon.com/musings/feed/',
  verbguac: 'https://verboseguacamole.com/feed/',
  masto: 'https://fosstodon.org/users/benjaminhollon.rss'
}
const feedCaches = {
  swec: false,
  musings: false,
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


  const items = (request.query.from || 'swec,musings,verbguac')
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

// Musings
app.get('/musings/', async (request, response) => {
  let articles = [];
  await crud.findMultipleDocuments('musings', {}).then((result) => {
    articles = result;
  });

  articles.sort((a, b) => new Date(b.date) - new Date(a.date));

  const recentHTML = JSON.parse(JSON.stringify(articles));

  articles.sort((a, b) => b.hits - a.hits);

  const popularHTML = JSON.parse(JSON.stringify(articles.slice(0, 5)));

  return response.render('musings.pug', {
    recent: recentHTML,
    popular: popularHTML,
    parameters: request.query,
    marked,
    config,
    cookies: request.cookies,
    subscribed: request.cookies.subscribed,
  });
});

// Musing Page
app.get('/musings/:articleId/', async (request, response) => {
  let article = {};
  await crud.findDocument('musings', { id: request.params.articleId }).then((result) => {
    article = result;
  });
  if (article === null) {
    response.status(404);
    return response.render('errors/404.pug', { cookies: request.cookies });
  }

  // Similar Articles
  let related = [];
  await crud.aggregate('musings', [
    {
      $match: {
        tags: {
          $elemMatch: {
            $in: article.tags,
          },
        },
        id: {
          $ne: article.id,
        },
      },
    },
    {
      $addFields: {
        matching: {
          $filter: {
            input: '$tags',
            cond: {
              $in: [
                '$$this', article.tags,
              ],
            },
          },
        },
      },
    },
    {
      $set: {
        matching: {
          $size: '$matching',
        },
      },
    },
    {
      $sort: {
        matching: -1,
      },
    },
    {
      $limit: 3,
    },
  ]).then((result) => {
    related = result;
  });

  article.hits += 1;
  crud.updateDocument('musings', { id: new RegExp(`^${request.params.articleId}$`, 'i') }, { hits: article.hits });

  function timeSince(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    let interval = seconds / 31536000;

    if (interval > 1) {
      return `${Math.floor(interval)} years`;
    }
    interval = seconds / 2592000;
    if (interval > 1) {
      return `${Math.floor(interval)} months`;
    }
    interval = seconds / 86400;
    if (interval > 1) {
      return `${Math.floor(interval)} days`;
    }
    interval = seconds / 3600;
    if (interval > 1) {
      return `${Math.floor(interval)} hours`;
    }
    interval = seconds / 60;
    if (interval > 1) {
      return `${Math.floor(interval)} minutes`;
    }
    return `${Math.floor(seconds)} seconds`;
  }

  // Comment time ago
  if (article.comments) {
    article.comments = article.comments.map((comment) => {
      const newComment = { ...comment };
      newComment.time = `${timeSince(newComment.time * 1000)} ago`;
      return newComment;
    });
  }
  return response.render('musing.pug', {
    article,
    related,
    siteKey: config.reCAPTCHApublic,
    parameters: request.query,
    marked,
    config,
    cookies: request.cookies,
    subscribed: request.cookies.subscribed,
  });
});


// Add/remove reaction
app.post('/musings/:articleId/reactions/:reaction/:action', async (request, response) => {
  // TECH DEBT: Integrate special updates into mongdb-crud
  let article = null;
  await crud.findDocument('musings', { id: request.params.articleId }).then((result) => {
    article = result;
  });
  const reaction = article.reactions.find((r) => r.name === request.params.reaction);
  if (article === null || !reaction) return response.status(404).end();
  const { reactions } = article;
  reactions[reactions.indexOf(reaction)].count = reaction.count + (request.params.action === 'remove' ? -1 : 1);
  await crud.updateDocument('musings', { id: article.id }, { reactions });
  response.status(204).end();
});

// Sign article
app.post('/musings/:articleId/sign', async (request, response) => {
  let article = null;
  await crud.findDocument('musings', { id: request.params.articleId }).then((result) => {
    article = result;
  });
  if (article === null || article.content.slice(-14) !== '[[signatures]]') return response.status(404).end();

  if (typeof article.signedBy === 'undefined') article.signedBy = [];

  if (request.body.name.length > 64) return response.redirect(302, `/musings/${request.params.articleId}/?err=a400`);

  article.signedBy.push(String(request.body.name));

  await crud.updateDocument('musings', { id: request.params.articleId }, { signedBy: article.signedBy });

  return response.redirect(302, `/musings/${request.params.articleId}/`);
});

// Add comment
app.post('/musings/:articleId/comment', async (request, response) => {
  if (!request.body.name || !request.body.comment || (request.body.comment && request.body.comment.length > 512) || (request.body.name && request.body.name.length > 128)) return response.redirect(302, `/musings/${request.params.articleId}/?err=${400}&name=${encodeURIComponent(request.body.name)}&comment=${encodeURIComponent(request.body.comment)}#comments`);

  // Honeytrap
  if (request.body.email.length) return response.redirect(302, `/musings/${request.params.articleId}/?err=honeytrap&name=${encodeURIComponent(request.body.name)}&comment=${encodeURIComponent(request.body.comment)}#comments`);

  let article;
  await crud.findDocument('musings', { id: request.params.articleId }).then((result2) => {
    article = result2;
  });

  if (article === null) return response.render('errors/404.pug', { cookies: request.cookies });

  article.comments.push({
    author: request.body.name,
    message: request.body.comment,
    time: Math.floor(Date.now() / 1000),
  });
  crud.updateDocument('musings', { id: request.params.articleId.toString() }, { comments: article.comments });

  return response.redirect(302, `/musings/${request.params.articleId}/#comments`);
});

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

// Errors
app.use((request, response) => {
  response.status(404);
  response.render('errors/404.pug', { cookies: request.cookies, config });
});

// Listen on port from config.json
app.listen(config.port, () => {
  console.info(`Server running on port ${config.port}`);
});
