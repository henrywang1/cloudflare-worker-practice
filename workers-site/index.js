import {
  getAssetFromKV,
  mapRequestToAsset
} from '@cloudflare/kv-asset-handler'

import {
  defaultData,
  static_url
} from './settings';

const DEBUG = false
const setCache = (key, data) => PRACTICE.put(key, data);
const getCache = key => PRACTICE.get(key);

async function getLinks() {
  const cacheKey = `data`;
  let data;
  const cache = await getCache(cacheKey);
  if (!cache) {
    await setCache(cacheKey, JSON.stringify(defaultData));
    data = defaultData;
  } else {
    data = JSON.parse(cache);
  }
  return data['links'];
}

async function getIcons(data) {
  const svgs = [];
  for (let item of data) {
    const cacheKey = item.name;
    const cache = await getCache(cacheKey);
    if (cache) {
      item['svg'] = cache;
    } else {
      item['svg'] = '';
    }
  }
}

addEventListener('fetch', event => {
  try {
    event.respondWith(handleEvent(event))
  } catch (e) {
    if (DEBUG) {
      return event.respondWith(
        new Response(e.message || e.toString(), {
          status: 500,
        }),
      )
    }
    event.respondWith(new Response('Internal Error', {
      status: 500
    }))
  }
})

async function gatherResponse(response) {
  const {
    headers
  } = response
  const contentType = headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return JSON.stringify(await response.json())
  } else if (contentType.includes('application/text')) {
    return await response.text()
  } else if (contentType.includes('text/html')) {
    return await response.text()
  } else {
    return await response.text()
  }
}

class DivTransformer {
  constructor(id, data) {
    this.id = id;
    this.links = data
  }

  async element(element) {
    let style = element.getAttribute('style');

    if (style) {
      style = style.split(';').reduce((str, attr) => str + attr.includes('display') ? '' : attr, '');
      element.setAttribute('style', style);
    }
    if (this.id == 'links') {
      this.links.slice().reverse().forEach(link => element.prepend(
        `<a href='${link.url}'>${link.name}</a>`, {
          html: true
        }));
    }
    if (this.id == 'social') {
      this.links.slice().reverse().forEach(link => element.prepend(
        `<a style='display: inline-block; margin: 0; width: 68px; height: 68px;' href='${link.url}'>
          ${link.svg}
        </a>`, {
          html: true
        }));
    }
  }
}

class BodyTransformer {
  async element(element) {
    let cls = element.getAttribute('class');
    if (cls) {
      cls = cls.split(' ');
      cls = cls.reduce((str, attr) => {
        if (str.length)
          str = str + ' ';
        if (attr == 'bg-gray-900') {
          str = str + 'bg-gradient-to-r from-blue-900 via-blue-700 to-orange-400';
        } else {
          str = str + attr;
        }
        return str;
      }, '');
      element.setAttribute('class', cls);
    }
  }
}

async function handleEvent(event) {
  const url = new URL(event.request.url)
  let options = {}

  try {
    if (DEBUG) {
      // customize caching
      options.cacheControl = {
        bypassCache: true,
      }
    }
    let data;
    if (url.pathname == '/' || url.pathname == '/links') {
      data = await getLinks();
    }
    if (url.pathname == '/') {
      await getIcons(data);

      const init = {
        headers: {
          'content-type': 'text/html;charset=UTF-8',
        },
      }
      const rewriter = new HTMLRewriter()
        .on('div#links', new DivTransformer('links', data))
        .on('div#profile', new DivTransformer('profile', data))
        .on('div#social', new DivTransformer('social', data))
        .on('div#profile h1#name', {
          element: e => e.setInnerContent('Han-Yi Wang')
        })
        .on('div#profile img#avatar', {
          element: e => e.setAttribute('src', '/img/wang.jpg')
        })
        .on('title', {
          element: e => e.setInnerContent('Han-Yi Wang')
        })
        .on('body', new BodyTransformer())

      const rewriter_svg = new HTMLRewriter()
        .on('svg', {
          element: e => e.setAttribute('class', 'hover:opacity-75 display: block margin: auto')
        })

      // class='hover:opacity-75 display: block margin: auto'

      const response = await fetch(static_url, init)
      const results = await gatherResponse(response)
      const res = new Response(results, init);
      const res_svg = rewriter.transform(res);
      return rewriter_svg.transform(res_svg);
    }

    if (url.pathname == '/links') {
      const json = JSON.stringify(data, null, 2)
      return new Response(json, {
        headers: {
          'content-type': 'application/json;charset=UTF-8'
        }
      });
    }
    const page = await getAssetFromKV(event, options)

    // allow headers to be altered
    const response = new Response(page.body, page)
    response.headers.set('X-XSS-Protection', '1; mode=block')
    response.headers.set('X-Content-Type-Options', 'nosniff')
    response.headers.set('X-Frame-Options', 'DENY')
    response.headers.set('Referrer-Policy', 'unsafe-url')
    response.headers.set('Feature-Policy', 'none')

    return response

  } catch (e) {
    // if an error is thrown try to serve the asset at 404.html
    if (!DEBUG) {
      try {
        let notFoundResponse = await getAssetFromKV(event, {
          mapRequestToAsset: req => new Request(`${new URL(req.url).origin}/404.html`, req),
        })

        return new Response(notFoundResponse.body, {
          ...notFoundResponse,
          status: 404
        })
      } catch (e) {}
    }
    return new Response(e.message || e.toString(), {
      status: 500
    })
  }
}