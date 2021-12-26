// Import modules
const express = require('express');
const compression = require('compression');
const bodyParser = require('body-parser');
const basicAuth = require('express-basic-auth');
const MarkdownIt = require('markdown-it');
const cookieParser = require('cookie-parser');

const md = new MarkdownIt({ html: true, typographer: true, linkify: true });

// Import config
const config = require('./config.json');
const directory = require('./directory.json');

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

// Errors
app.use((request, response) => {
  response.status(404);
  response.render('errors/404.pug', { cookies: request.cookies });
});

// Listen on port from config.json
app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
