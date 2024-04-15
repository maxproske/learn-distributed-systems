const express = require('express');
const dns = require('dns').promises;
const bodyParser = require('body-parser');

async function master() {
  const type = process.env.TYPE;

  if (type === 'MASTER') {
    const app = express();
    app.use(bodyParser.json());

    app.get('/compute', async (req, res) => {
      const text = req.query.text;
      const words = text.split(' ');

      // MAPPING

      const mapperHost = process.env.MAPPER_HOST;
      const mapperIps = await dns.lookup(mapperHost, { all: true, family: 4 }).then(ips => ips.map(ip => ip.address));

      const mapSplitCount = Math.ceil(words.length / mapperIps.length);
      const mapSplits = {};

      for (let idx = 0; idx < mapperIps.length; idx++) {
        const start = idx * mapSplitCount;
        const end = Math.min((idx + 1) * mapSplitCount, words.length);
        mapSplits[mapperIps[idx]] = words.slice(start, end).join(' ');
      }

      console.log("Split step:", mapSplits);

      const mapping = {};
      const wgm = await Promise.all(
        Object.entries(mapSplits).map(async ([host, split]) => {
          const data = JSON.stringify({ str: split });
          const url = `http://${host}:${process.env.MAPPER_PORT}/map`;
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: data
          });
          return {[host]: await response.json()};
        })
      );

      wgm.forEach(result => Object.assign(mapping, result));
      console.log("Map step:", mapping);

      // SHUFFLING

      const shuffling = {};
      Object.values(mapping).forEach(map => {
        Object.entries(map).forEach(([word, count]) => {
          if (!shuffling[word]) {
            shuffling[word] = [];
          }
          shuffling[word].push(count);
        });
      });

      console.log("Shuffle step:", shuffling);

      // REDUCING

      const reducerHost = process.env.REDUCER_HOST;
      const reducerIps = await dns.lookup(reducerHost, { all: true, family: 4 }).then(ips => ips.map(ip => ip.address));

      const reduceSplits = {};
      Object.entries(shuffling).forEach(([word, counts], idx) => {
        const host = reducerIps[idx % reducerIps.length];
        if (!reduceSplits[host]) {
          reduceSplits[host] = {};
        }
        reduceSplits[host][word] = counts;
      });

      console.log("Reduce splits:", reduceSplits);

      const wgr = await Promise.all(
        Object.entries(reduceSplits).map(async ([host, split]) => {
          const data = JSON.stringify(split);
          const url = `http://${host}:${process.env.REDUCER_PORT}/reduce`;
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: data
          });
          return {[host]: await response.json()};
        })
      );

      const reducing = Object.assign({}, ...wgr.map(result => result[Object.keys(result)[0]]));
      console.log("Reduce step:", reducing);

      res.json(reducing);
    });

    app.listen(3000, () => console.log('Master listening on port 3000'));
  }
}

function mapper() {
    const app = express();
    app.use(bodyParser.json());
  
    app.post('/map', (req, res) => {
      const str = req.body.str;
      const words = str.split(' ');
  
      const mapping = words.reduce((acc, word) => {
        acc[word] = (acc[word] || 0) + 1; // Increment count for each word
        return acc;
      }, {});
  
      res.json(mapping);
    });
  
    app.listen(3000, () => console.log('Mapper listening on port 3000'));
  }
  
function reducer() {
    const app = express();
    app.use(bodyParser.json());
  
    app.post('/reduce', (req, res) => {
      const reduceData = req.body;
      console.log({body: req.body})
  
      const reducing = Object.keys(reduceData).reduce((acc, word) => {
        acc[word] = reduceData[word].reduce((wAcc, count) => wAcc + count, 0);
        return acc;
      }, {});
  
      res.json(reducing);
    });
  
    app.listen(3000, () => console.log('Reducer listening on port 3000'));
}
  
const type = process.env.TYPE;
  
if (type === 'MAP') {
    mapper();
} else if (type === 'MASTER') {
    master();
} else if (type === 'REDUCE') {
    reducer();
} else {
    console.error('Invalid process type. Please set TYPE environment variable to MAP, MASTER, or REDUCE');
}
