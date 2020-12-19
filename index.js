function aggregate(runs) {
  let players = [];
  for (const run of runs) {
    const runner = players.find((r) => r.runner === run.runner);
    if (runner) {
      runner.points += calculatePoints(run.place);
    } else {
      players.push({
        runner: run.runner,
        points: calculatePoints(run.place),
      });
    }
  }
  return players.sort((a,b) => b.points - a.points);
}

function mapPoints(runs, withLevel) {
  return runs.map((run) => ({
    runner: !withLevel ? run.runner : undefined,
    level: withLevel ? run.level : undefined,
    time: run.time,
    points: calculatePoints(run.place),
  }));
}

function calculatePoints(num) {
  switch(num) {
    case 1:
      return 100;
    case 2:
      return 97;
    case 3:
      return 95;
    default:
      return Math.max(98 - num, 0);
  }
}

async function pullData() {
  let runs = [];
  const res = await fetch('https://speedrun.com/api/v1/games/rac4?embed=levels');
  const out = await res.json();
  const data = await getCache();
  const levels = out.data.levels.data;
  const firstHalf = levels.slice(0, levels.length / 2);
  const secondHalf = levels.slice(levels.length / 2);

  const cacheIsOld = data && new Date(data.lastUpdated).getDate() - new Date().getDate() > 0;
  const halfToUpdate = cacheIsOld ? firstHalf : secondHalf;
  const halfToMerge = cacheIsOld ? secondHalf : firstHalf;
  for (const level of halfToUpdate) {
    const levelName = level.name;
    const leaderboardLink = level.links[6].uri;
    const levelRes = await fetch(`${leaderboardLink}?embed=players`);
    const leaderboard = await levelRes.json();

    for (let i = 0; i < leaderboard.data.runs.length; i++) {
      const run = leaderboard.data.runs[i];
      const player = leaderboard.data.players.data[i];
      const playerName = player.name || player.names.international;
      const runObj = {
        level: levelName,
        time: run.run.times.primary_t,
        place: run.place,
        runner: playerName,
      }
      runs.push(runObj);
    }
  }

  const mergingLevelNames = halfToMerge.map((level) => level.name);
  const mergingRuns = data ? data.runs.filter((run) => mergingLevelNames.includes(run.level)) : [];
  runs = [...runs, ...mergingRuns];
  DL_ILS.put('data', JSON.stringify({ runs, lastUpdated: !data || cacheIsOld ? new Date().toISOString() : data.lastUpdated }));
}

addEventListener("scheduled", event => {
  event.waitUntil(handleScheduled(event));
})

async function handleScheduled(_event) {
  await pullData();
}

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

const getCache = async () => JSON.parse(await DL_ILS.get('data'));

/**
 * Respond with hello worker text
 * @param {Request} request
 */
async function handleRequest(request) {
  try {
    const { searchParams } = new URL(request.url);
    const data = await getCache();
    const runner = searchParams.get('runner');
    const level = searchParams.get('level');
    const runs = data.runs;

    let response;
    if (runner && level) {
      const run = runs.find((run) => run.runner === runner && run.level === level);
      if (run) {
        response = {
          time: run.time,
          points: calculatePoints(run.place),
        };
      }
    } else if (level) {
      const filtered = runs.filter((run) => run.level === level);
      if (filtered.length) {
        response = mapPoints(filtered, false);
      }
    } else if (runner) {
      const filtered = runs.filter((run) => run.runner === runner);
      if (filtered.length) {
        response = mapPoints(filtered, true)
      }
    } else {
      response = aggregate(runs);
    }

    if (response) {
      return new Response(JSON.stringify({
        data: response,
        lastUpdated: data.lastUpdated,
      }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response('No runs found.', {
      headers: { 'content-type': 'text/plain', status: 200 },
    });
  } catch (e) {
    return new Response(e, { status: 500 })
  }
}
