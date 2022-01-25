function generateFeedLink() {
  q = (s) => document.querySelector(s)
  const feeds = [
    (!q('#swec-feed').checked || 'swec'),
    (!q('#musings-feed').checked || 'musings'),
    (!q('#verbguac-feed').checked || 'verbguac'),
    (!q('#masto-feed').checked || 'masto'),
  ].filter(i => typeof i === 'string').join(',');

  const link = 'https://benjaminhollon.com/feed/?from=' + encodeURIComponent(feeds);
  q('#finalFeed').innerHTML = '<a href="' + link + '">' + link + '</a>';
  q('#final').classList.remove('hidden');
}
