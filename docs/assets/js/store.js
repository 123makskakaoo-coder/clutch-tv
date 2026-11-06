/* Data layer: everything lives in localStorage under one key. */
(function (global) {
  const KEY = 'clutch-tv.data.v1';
  const ADMIN_KEY = 'clutch-tv.admin.key';
  const ADMIN_SESSION = 'clutch-tv.admin.ok';
  const KINDS = ['news', 'matches', 'teams', 'events', 'brackets', 'players'];
  const empty = () => ({ version: 1, news: [], matches: [], teams: [], events: [], brackets: [], players: [], updatedAt: null });

  /* Padlock, not a safe: the key is kept as a fingerprint so nobody reads it from the saved data. */
  function fingerprint(text) {
    let h = 2166136261;
    const s = 'clutch|' + String(text);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return String(h);
  }
  const admin = {
    has: () => !!localStorage.getItem(ADMIN_KEY),
    check: (text) => localStorage.getItem(ADMIN_KEY) === fingerprint(text),
    set: (text) => localStorage.setItem(ADMIN_KEY, fingerprint(text)),
    ok: () => sessionStorage.getItem(ADMIN_SESSION) === '1',
    unlock: () => sessionStorage.setItem(ADMIN_SESSION, '1'),
    lock: () => sessionStorage.removeItem(ADMIN_SESSION)
  };

  /* ---------- bracket engine ---------- */
  const emptySlot = () => ({ a: null, b: null, sa: null, sb: null, when: '', bo: '', live: false, stream: '' });

  /* A slot with one team is a bye; an empty or equal score has no winner. */
  function winnerOf(slot) {
    if (!slot) return null;
    const hasScore = slot.sa !== null && slot.sa !== undefined && slot.sa !== '' &&
      slot.sb !== null && slot.sb !== undefined && slot.sb !== '';
    if (hasScore && Number(slot.sa) !== Number(slot.sb)) return Number(slot.sa) > Number(slot.sb) ? slot.a : slot.b;
    if (slot.a && !slot.b) return slot.a;
    if (slot.b && !slot.a) return slot.b;
    return null;
  }
  function loserOf(slot) {
    const win = winnerOf(slot);
    if (!win) return null;
    return win === slot.a ? slot.b : slot.a;
  }

  const roundDef = (key, name, side, slots) => ({ key, name, side, slots });

  /* Swiss to three wins: score groups laid out the way the board reads, left to right. */
  const SWISS_COLS = [['0-0'], ['1-0', '0-1'], ['2-0', '1-1', '0-2'], ['3-0', '2-1', '1-2', '0-3'], ['3-1', '3-2', '2-2', '1-3', '2-3']];
  const SWISS_GROUPS = SWISS_COLS.reduce((all, col) => all.concat(col), []);
  const swissCol = (key) => {
    const i = SWISS_COLS.findIndex((col) => col.indexOf(key) >= 0);
    if (i >= 0) return i;
    const parts = String(key || '').split('-').map(Number);
    return isNaN(parts[0]) || isNaN(parts[1]) ? SWISS_COLS.length - 1 : Math.min(parts[0] + parts[1], SWISS_COLS.length - 1);
  };

  /* Names saved by older builds, renamed only while they still hold the old default. */
  const OLD_ROUND_NAMES = {
    '1/4 финала': 'Четвертьфиналы', 'Финал': 'Гранд-финал', 'Матч за 3-е место': 'дополнительный раунд'
  };

  /* A bronze match only makes sense when the loser of the upper final has nowhere else to drop. */
  const thirdAllowed = (type, size) => type === 'single' || (type === 'double' && Number(size) !== 4);

  function topology(type, size, thirdPlace) {
    const bronze = !!thirdPlace && thirdAllowed(type, size);
    if (type === 'swiss') {
      const first = Math.max(1, Math.ceil(Number(size) / 2) || 4);
      return SWISS_GROUPS.map((n) => roundDef(n, n, 'swiss', n === '0-0' ? first : 0));
    }
    if (type === 'double') {
      const list = size === 4
        ? [roundDef('U1', 'Первый раунд', 'upper', 2), roundDef('UF', 'Верхний финал', 'upper', 1),
          roundDef('L1', 'Нижний раунд 1', 'lower', 1), roundDef('LF', 'Нижний финал', 'lower', 1),
          roundDef('GF', 'Гранд-финал', 'final', 1)]
        : [roundDef('U1', 'Первый раунд', 'upper', 4), roundDef('U2', 'Верхние полуфиналы', 'upper', 2),
          roundDef('UF', 'Верхний финал', 'upper', 1), roundDef('L1', 'Нижний раунд 1', 'lower', 2),
          roundDef('L2', 'Нижние полуфиналы', 'lower', 2), roundDef('LF', 'Нижний финал', 'lower', 1),
          roundDef('GF', 'Гранд-финал', 'final', 1)];
      if (bronze) list.push(roundDef('TP', 'дополнительный раунд', 'third', 1));
      return list;
    }
    const names = { 2: ['Гранд-финал'], 4: ['Полуфиналы', 'Гранд-финал'], 8: ['Четвертьфиналы', 'Полуфиналы', 'Гранд-финал'], 16: ['1/8 финала', 'Четвертьфиналы', 'Полуфиналы', 'Гранд-финал'] };
    const list = (names[size] || names[8]).map((n, i, arr) => roundDef(i === arr.length - 1 ? 'F' : 'R' + (i + 1), n, 'main', Math.pow(2, arr.length - 1 - i)));
    if (bronze) list.push(roundDef('TP', 'дополнительный раунд', 'third', 1));
    return list;
  }

  function buildRounds(type, size, thirdPlace) {
    return topology(type, size, thirdPlace).map((d) => ({
      key: d.key, name: d.name, side: d.side, slots: Array.from({ length: d.slots }, emptySlot)
    }));
  }

  /* Older saved brackets have no type/key/side — fill them in. */
  function normalizeBracket(b) {
    if (!b || typeof b !== 'object' || !Array.isArray(b.rounds)) return b;
    b.type = b.type || 'single';
    b.rounds = b.rounds.filter((r) => r && typeof r === 'object');
    b.rounds.forEach((r, i) => {
      if (!r.key) r.key = b.type === 'single' && i === b.rounds.length - 1 ? 'F' : 'R' + (i + 1);
      if (!r.side) {
        r.side = b.type !== 'double' ? b.type === 'swiss' ? 'swiss' : 'main'
          : r.key === 'GF' ? 'final' : r.key.indexOf('L') === 0 ? 'lower' : 'upper';
      }
      if (Object.prototype.hasOwnProperty.call(OLD_ROUND_NAMES, r.name)) r.name = OLD_ROUND_NAMES[r.name];
      r.slots = (r.slots || []).map((s) => Object.assign(emptySlot(), s));
    });
    /* Boards made before the full 3-win run only carry nine groups — the rest are added empty. */
    if (b.type === 'swiss') {
      SWISS_GROUPS.forEach((key) => {
        if (!b.rounds.some((r) => r.key === key)) b.rounds.push({ key, name: key, side: 'swiss', slots: [] });
      });
      const rank = (r) => { const i = SWISS_GROUPS.indexOf(r.key); return i < 0 ? SWISS_GROUPS.length + 9 : i; };
      b.rounds.sort((x, y) => rank(x) - rank(y));
    }
    return b;
  }

  const byKey = (rounds) => {
    const map = {};
    rounds.forEach((r) => { map[r.key] = r; });
    return map;
  };
  const feed = (slot, pos, team) => { if (slot) slot[pos % 2 === 0 ? 'a' : 'b'] = team || null; };

  /* Rebuilds every computed round from the results above it. */
  function propagate(bracket) {
    if (!bracket || !Array.isArray(bracket.rounds) || !bracket.rounds.length) return bracket ? bracket.rounds : null;
    const rounds = bracket.rounds;
    const type = bracket.type || 'single';
    if (type === 'swiss') return rounds;
    const key = byKey(rounds);
    rounds.forEach((r, i) => { if (i > 0) r.slots.forEach((s) => { s.a = null; s.b = null; }); });

    if (type === 'double') {
      const u1 = key.U1;
      if (u1) u1.slots.forEach((slot, i) => {
        const win = winnerOf(slot);
        if (key.U2) feed(key.U2.slots[Math.floor(i / 2)], i, win);
        else feed(key.UF && key.UF.slots[0], i, win);
        if (key.L1) feed(key.L1.slots[Math.floor(i / 2)], i, loserOf(slot));
      });
      if (key.U2) key.U2.slots.forEach((slot, i) => {
        feed(key.UF && key.UF.slots[0], i, winnerOf(slot));
        if (key.L2) feed(key.L2.slots[i], 0, loserOf(slot));
      });
      if (key.L1) key.L1.slots.forEach((slot, i) => {
        const win = winnerOf(slot);
        if (key.L2) feed(key.L2.slots[i], 1, win);
        else feed(key.LF && key.LF.slots[0], i, win);
      });
      if (key.L2) key.L2.slots.forEach((slot, i) => feed(key.LF && key.LF.slots[0], i, winnerOf(slot)));
      /* On a four-team bracket the loser of the upper final drops straight into the lower final. */
      if (!key.L2 && key.LF) feed(key.LF.slots[0], 1, loserOf(key.UF ? key.UF.slots[0] : null));
      feed(key.GF && key.GF.slots[0], 0, winnerOf(key.UF ? key.UF.slots[0] : null));
      feed(key.GF && key.GF.slots[0], 1, winnerOf(key.LF ? key.LF.slots[0] : null));
      if (key.TP) {
        const fromUpper = loserOf(key.UF ? key.UF.slots[0] : null);
        const fromLower = loserOf(key.LF ? key.LF.slots[0] : null);
        key.TP.slots[0].a = fromUpper;
        key.TP.slots[0].b = fromLower && fromLower !== fromUpper ? fromLower : null;
      }
      return tidy(rounds);
    }

    for (let r = 0; r < rounds.length - 1; r++) {
      const next = rounds[r + 1];
      if (!next || next.side === 'third') continue;
      rounds[r].slots.forEach((slot, i) => feed(next.slots[Math.floor(i / 2)], i, winnerOf(slot)));
    }
    if (key.TP) {
      const semis = rounds.filter((r) => r.side !== 'third' && r.key !== 'F').pop();
      if (semis && semis.slots.length === 2) {
        key.TP.slots[0].a = loserOf(semis.slots[0]);
        key.TP.slots[0].b = loserOf(semis.slots[1]);
      }
    }
    return tidy(rounds);
  }

  /* A computed match with nobody in it cannot have a score. */
  function tidy(rounds) {
    rounds.forEach((r, i) => {
      if (i === 0) return;
      r.slots.forEach((s) => { if (!s.a && !s.b) { s.sa = null; s.sb = null; } });
    });
    return rounds;
  }

  /* Swiss: standings are counted from played matches, pairings stay manual. */
  function tally(rounds) {
    const table = {};
    (rounds || []).forEach((r) => (r.slots || []).forEach((s) => {
      const win = winnerOf(s);
      const lose = loserOf(s);
      if (!win || !lose) return;
      table[win] = table[win] || { w: 0, l: 0 };
      table[lose] = table[lose] || { w: 0, l: 0 };
      table[win].w++;
      table[lose].l++;
    }));
    return table;
  }
  const records = (bracket) => tally(bracket && bracket.rounds);

  const swissTeams = (bracket) => {
    const seen = [];
    ((bracket && bracket.rounds) || []).forEach((r) => (r.slots || []).forEach((s) => {
      [s.a, s.b].forEach((t) => { if (t && seen.indexOf(t) < 0) seen.push(t); });
    }));
    return seen;
  };

  /* Builds the pairs of one score group: mode 'seed' sorts by rating, anything else shuffles. */
  function pairSwiss(bracket, groupKey, mode, teams) {
    const group = ((bracket && bracket.rounds) || []).find((r) => r.key === groupKey);
    if (!group) return null;
    const done = tally(((bracket.rounds || []).filter((r) => r.key !== groupKey)));
    const parts = groupKey.split('-').map(Number);
    const pool = groupKey === '0-0'
      ? swissTeams(bracket).filter((t) => !done[t])
      : Object.keys(done).filter((t) => done[t].w === parts[0] && done[t].l === parts[1]);
    if (pool.length < 2) return null;
    const rating = {};
    (teams || []).forEach((t) => {
      const points = Number(t.points) || 0;
      rating[String(t.name).toLowerCase()] = points;
      if (t.short) rating[String(t.short).toLowerCase()] = points;
    });
    const rank = (name) => rating[String(name).toLowerCase()] || 0;
    const list = pool.slice();
    if (mode === 'seed') list.sort((x, y) => rank(y) - rank(x));
    else for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    }
    group.slots = [];
    for (let i = 0; i < list.length; i += 2) {
      const slot = emptySlot();
      const pair = list[i + 1] ? [list[i], list[i + 1]].sort((x, y) => rank(y) - rank(x)) : [list[i]];
      slot.a = pair[0];
      slot.b = pair[1] || null;
      group.slots.push(slot);
    }
    return group.slots.length;
  }

  /* ---------- players ---------- */
  /* A profile hangs off the nickname typed into a roster, so the lineup stays the one place he edits. */
  const normNick = (text) => String(text == null ? '' : text).toLowerCase().trim();

  /* A roster line still holding a placeholder is not a player yet. */
  const realNick = (text) => {
    const s = String(text == null ? '' : text).trim();
    return s && s !== '?' && s !== '—' && s !== '-' ? s : '';
  };

  function playerRecord(nick) {
    const want = normNick(nick);
    return Store.list('players').find((p) => normNick(p.nick) === want) || null;
  }

  function teamOfNick(nick) {
    const want = normNick(nick);
    return Store.list('teams').find((t) => lineOf(t, want) ? true : false) || null;
  }

  /* Запас — вторая строка команды: игрок числится за командой, но в основном составе не стоит. */
  function lineOf(team, want) {
    if (!team || !want) return '';
    const inRoster = (team.roster || []).map(realNick).find((n) => normNick(n) === want);
    return inRoster || (team.bench || []).map(realNick).find((n) => normNick(n) === want) || '';
  }

  function benchPlayers(team) {
    if (!team) return [];
    const seen = {};
    const list = [];
    (team.bench || []).forEach((raw) => {
      const nick = realNick(raw);
      if (!nick || seen[normNick(nick)]) return;
      seen[normNick(nick)] = true;
      list.push({ nick, team, rec: playerRecord(nick) });
    });
    return list;
  }

  function benchList() {
    return Store.list('teams').slice().sort((a, b) => (b.points || 0) - (a.points || 0))
      .map((team) => ({ team, players: benchPlayers(team) }))
      .filter((row) => row.players.length);
  }

  function rosterPlayers(team) {
    if (!team) return [];
    const seen = {};
    const list = [];
    (team.roster || []).forEach((raw) => {
      const nick = realNick(raw);
      if (!nick || seen[normNick(nick)]) return;
      seen[normNick(nick)] = true;
      list.push({ nick, team, rec: playerRecord(nick) });
    });
    return list;
  }

  /* Profiles for every nickname in the base; a filled record nobody rostered any more stays visible as a free agent. */
  function allPlayers() {
    const teams = Store.list('teams').slice().sort((a, b) => (b.points || 0) - (a.points || 0));
    const seen = {};
    const out = [];
    teams.forEach((team) => rosterPlayers(team).concat(benchPlayers(team)).forEach((p) => {
      seen[normNick(p.nick)] = true;
      out.push(p);
    }));
    Store.list('players').forEach((rec) => {
      const nick = realNick(rec.nick);
      if (!nick || seen[normNick(nick)]) return;
      seen[normNick(nick)] = true;
      out.push({ nick, team: null, rec });
    });
    return out;
  }

  /* The roster's spelling wins over the record's, so a renamed lineup line shows the new one. */
  function playerView(nick) {
    const want = normNick(nick);
    if (!want) return null;
    const team = teamOfNick(want);
    if (team) {
      const line = lineOf(team, want);
      return { nick: line || String(nick).trim(), team, rec: playerRecord(want) };
    }
    const rec = playerRecord(want);
    return rec ? { nick: rec.nick, team: null, rec } : null;
  }

  /* Old saves have no players at all — the profiles simply come from the rosters until something is filled in. */
  function playerHistory(rec) {
    return (rec && Array.isArray(rec.history) ? rec.history : []).filter((row) => row && (row.team || row.period));
  }

  /* An unreadable save must never look like an empty base that the next write overwrites. */
  let broken = '';
  let seedUsed = false;

  function safeNormalize(b) {
    try { return normalizeBracket(b); }
    catch (err) { console.error('CLUTCH.TV: сетка повреждена, оставили как есть', b && b.id, err); return b; }
  }

  function hydrate(data) {
    const state = empty();
    KINDS.forEach((k) => { if (Array.isArray(data[k])) state[k] = data[k]; });
    state.brackets = state.brackets.map(safeNormalize);
    state.updatedAt = data.updatedAt || null;
    return state;
  }
  const stamp = (value) => Date.parse(value || '') || 0;

  /* seed/data.js is the published snapshot: whoever opens the site gets it, until the browser holds a newer base. */
  function snapshot() {
    const data = global.CLUTCH_SEED;
    if (!data || typeof data !== 'object') return null;
    try { return hydrate(data); }
    catch (err) { console.error('CLUTCH.TV: публичный снимок не читается', err); return null; }
  }

  function read() {
    let stored = null;
    seedUsed = false;
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) {
        broken = '';
        const fresh = snapshot();
        seedUsed = !!fresh;
        return fresh || empty();
      }
      stored = hydrate(JSON.parse(raw));
      broken = '';
    } catch (err) {
      broken = String(err.message || err);
      console.error('CLUTCH.TV: не удалось прочитать сохранённые данные', err);
    }
    const seed = snapshot();
    if (seed && stamp(seed.updatedAt) > stamp(stored && stored.updatedAt)) { seedUsed = true; return seed; }
    return stored || empty();
  }

  function write(state, force) {
    /* Incremental saves wait until the base is readable again; a deliberate import or wipe forces through. */
    if (broken && !force) {
      global.dispatchEvent(new CustomEvent('store:error', { detail: 'Сохранённые данные не читаются — обычное сохранение выключено, чтобы не стереть базу. Вернуть всё можно импортом из файла во вкладке «Резервные копии».' }));
      return false;
    }
    if (force) broken = '';
    state.updatedAt = new Date().toISOString();
    seedUsed = false;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      global.dispatchEvent(new CustomEvent('store:change'));
      return true;
    } catch (err) {
      console.error('CLUTCH.TV: браузер не дал сохранить данные', err);
      global.dispatchEvent(new CustomEvent('store:error', { detail: String(err.message || err) }));
      return false;
    }
  }

  const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

  const daysFromNow = (d, hour) => {
    const date = new Date();
    date.setDate(date.getDate() + d);
    date.setHours(hour === undefined ? 18 : hour, 0, 0, 0);
    return date.toISOString();
  };

  function exampleBrackets(data) {
    const evId = (name) => {
      const found = data.events.find((e) => e.name === name);
      return found ? found.id : null;
    };
    const make = (eventId, name, type, size, thirdPlace) => ({
      id: uid(), eventId, name, type, size, thirdPlace: !!thirdPlace, rounds: buildRounds(type, size, thirdPlace)
    });
    const roundOf = (b, key) => b.rounds.find((r) => r.key === key);
    /* Teams of the first round are typed in by hand. */
    const seed = (b, key, rows) => {
      rows.forEach((row, i) => {
        const slot = roundOf(b, key).slots[i];
        if (!slot) return;
        slot.a = row[0]; slot.b = row[1]; slot.sa = row[2]; slot.sb = row[3];
        slot.when = row[4] || ''; slot.bo = row[5] || '';
      });
      return propagate(b) && b;
    };
    /* Scores of a computed round: teams arrive from the round above. */
    const result = (b, key, i, sa, sb, when, bo) => {
      const slot = roundOf(b, key).slots[i];
      slot.sa = sa; slot.sb = sb;
      slot.when = when || slot.when || '';
      slot.bo = bo || slot.bo || '';
      return propagate(b) && b;
    };

    const cct = seed(make(evId('CCT Season 3 European Series'), 'Плей-офф', 'single', 8, true), 'R1', [
      ['NAVI', 'Astralis', 2, 0, '17:00 Суббота', 'BO3'],
      ['Vitality', 'MOUZ', 2, 1, '20:00 Суббота', 'BO3'],
      ['Team Spirit', 'G2 Esports', 1, 2, '17:00 Воскресенье', 'BO3'],
      ['FaZe Clan', 'The MongolZ', 2, 0, '20:00 Воскресенье', 'BO3']
    ]);
    result(cct, 'R2', 0, 2, 1, '16:00 Понедельник', 'BO3');

    const blast = seed(make(evId('BLAST Open Fall'), 'Плей-офф', 'single', 8), 'R1', [
      ['NAVI', 'FaZe Clan', null, null, '15:00 Четверг', 'BO3'],
      ['Vitality', 'Astralis', null, null, '18:00 Четверг', 'BO3'],
      ['Team Spirit', 'The MongolZ', null, null, '15:00 Пятница', 'BO3'],
      ['G2 Esports', 'MOUZ', null, null, '18:00 Пятница', 'BO3']
    ]);

    const iem = seed(make(evId('IEm Cologne'), 'Плей-офф', 'single', 4), 'R1', [
      ['G2 Esports', 'Team Spirit', 2, 1, '14:00 Воскресенье', 'BO3'],
      ['Vitality', 'NAVI', 2, 0, '17:00 Воскресенье', 'BO3']
    ]);
    result(iem, 'F', 0, 2, 1, '20:00 Воскресенье', 'BO5');

    const deb = seed(make(evId('BLAST Open Fall'), 'Группа A, двойная', 'double', 8), 'U1', [
      ['NAVI', 'Astralis', 2, 0, '12:00 Пятница', 'BO3'],
      ['Vitality', 'MOUZ', 1, 2, '15:00 Пятница', 'BO3'],
      ['Team Spirit', 'G2 Esports', 2, 1, '18:00 Пятница', 'BO3'],
      ['FaZe Clan', 'The MongolZ', 2, 0, '21:00 Пятница', 'BO3']
    ]);
    result(deb, 'U2', 0, 2, 1, '14:00 Суббота', 'BO3');
    result(deb, 'U2', 1, 1, 2, '17:00 Суббота', 'BO3');
    result(deb, 'L1', 0, 0, 2, '12:00 Суббота', 'BO3');
    result(deb, 'L1', 1, 2, 1, '12:00 Суббота', 'BO3');
    result(deb, 'UF', 0, 2, 1, '20:00 Воскресенье', 'BO3');
    result(deb, 'L2', 0, 1, 2, '14:00 Воскресенье', 'BO3');
    result(deb, 'L2', 1, 2, 0, '17:00 Воскресенье', 'BO3');
    result(deb, 'LF', 0, 2, 1, '19:00 Воскресенье', 'BO3');

    const swiss = make(evId('PGL Astana'), 'Группа B, швейцарка до 3 побед', 'swiss', 8);
    const play = (b, record, rows) => {
      const group = roundOf(b, record);
      rows.forEach((row, i) => {
        let slot = group.slots[i];
        if (!slot) { slot = emptySlot(); group.slots.push(slot); }
        slot.a = row[0]; slot.b = row[1]; slot.sa = row[2]; slot.sb = row[3];
        slot.when = row[4] || ''; slot.bo = row[5] || 'BO3';
      });
      return b;
    };
    play(swiss, '0-0', [
      ['NAVI', 'MOUZ', 2, 0, '11:00 Среда'],
      ['Vitality', 'Astralis', 2, 1, '11:00 Среда'],
      ['Team Spirit', 'The MongolZ', 1, 2, '14:00 Среда'],
      ['FaZe Clan', 'G2 Esports', 2, 0, '14:00 Среда']
    ]);
    play(swiss, '1-0', [
      ['NAVI', 'Vitality', 2, 1, '11:00 Четверг'],
      ['FaZe Clan', 'The MongolZ', 1, 2, '14:00 Четверг']
    ]);
    play(swiss, '0-1', [
      ['MOUZ', 'Astralis', 2, 0, '11:00 Четверг'],
      ['Team Spirit', 'G2 Esports', 2, 1, '14:00 Четверг']
    ]);
    play(swiss, '1-1', [
      ['Vitality', 'The MongolZ', null, null, '17:00 Четверг'],
      ['MOUZ', 'Team Spirit', null, null, '17:00 Четверг']
    ]);
    play(swiss, '2-0', [['NAVI', 'FaZe Clan', 2, 0, '11:00 Пятница']]);

    /* Sixteen teams run through the same score groups; results are consistent group by group. */
    const wide = play(make(evId('PGL Astana'), 'Группа A, швейцарка до 3 побед', 'swiss', 16), '0-0', [
      ['NAVI', 'Nexus', 2, 0, '11:00 Понедельник'],
      ['Vitality', 'Lynn Vision', 2, 1, '11:00 Понедельник'],
      ['Team Spirit', '3DMAX', 2, 0, '14:00 Понедельник'],
      ['FaZe Clan', 'Cloud9', 2, 1, '14:00 Понедельник'],
      ['G2 Esports', 'FlyQuest', 2, 0, '17:00 Понедельник'],
      ['MOUZ', 'FURIA', 2, 1, '17:00 Понедельник'],
      ['The MongolZ', 'Heroic', 2, 1, '20:00 Понедельник'],
      ['Astralis', 'Ninjas in Pyjamas', 2, 0, '20:00 Понедельник']
    ]);
    play(wide, '1-0', [
      ['NAVI', 'Vitality', 2, 1, '11:00 Вторник'],
      ['Team Spirit', 'FaZe Clan', 2, 0, '14:00 Вторник'],
      ['MOUZ', 'G2 Esports', 2, 1, '17:00 Вторник'],
      ['The MongolZ', 'Astralis', 2, 1, '20:00 Вторник']
    ]);
    play(wide, '0-1', [
      ['Nexus', 'Lynn Vision', 2, 0, '11:00 Вторник'],
      ['Cloud9', '3DMAX', 2, 0, '14:00 Вторник'],
      ['FlyQuest', 'FURIA', 2, 1, '17:00 Вторник'],
      ['Ninjas in Pyjamas', 'Heroic', 2, 1, '20:00 Вторник']
    ]);
    play(wide, '1-1', [
      ['Vitality', 'Cloud9', 2, 0, '11:00 Среда'],
      ['FaZe Clan', 'Nexus', 2, 1, '14:00 Среда'],
      ['G2 Esports', 'Ninjas in Pyjamas', null, null, '17:00 Среда'],
      ['Astralis', 'FlyQuest', null, null, '20:00 Среда']
    ]);
    play(wide, '2-0', [
      ['NAVI', 'MOUZ', 2, 1, '11:00 Четверг'],
      ['Team Spirit', 'The MongolZ', null, null, '14:00 Четверг']
    ]);

    /* The second group of the same event: one match is on air right now. */
    const groupB = seed(make(evId('CCT Season 3 European Series'), 'Группа B, двойная', 'double', 8), 'U1', [
      ['Vitality', 'Ninjas in Pyjamas', 2, 0, '12:00 Пятница', 'BO3'],
      ['Team Spirit', 'Heroic', 2, 1, '15:00 Пятница', 'BO3'],
      ['G2 Esports', 'Cloud9', 1, 2, '18:00 Пятница', 'BO3'],
      ['MOUZ', 'FURIA', 2, 0, '21:00 Пятница', 'BO3']
    ]);
    result(groupB, 'U2', 0, 2, 1, '14:00 Суббота', 'BO3');
    result(groupB, 'L1', 0, 2, 1, '12:00 Суббота', 'BO3');
    roundOf(groupB, 'L1').slots[0].live = true;

    return [cct, blast, iem, deb, swiss, wide, groupB];
  }

  function example() {
    const data = {
      version: 1,
      updatedAt: null,
      teams: [
        { id: uid(), name: 'Natus Vincere', short: 'NAVI', country: 'UA', region: 'EU', points: 812, move: 0, roster: ['AleksZ', 'b1t', 'iM', 'w0nderful', 'mak'] },
        { id: uid(), name: 'Vitality', short: 'VIT', country: 'FR', region: 'EU', points: 794, move: 2, roster: ['ZywOo', 'apEX', 'flameZ', 'mezii', 'ropz'] },
        { id: uid(), name: 'FaZe Clan', short: 'FAZE', country: 'US', region: 'EU', points: 771, move: -1, roster: ['karrigan', 'rain', 'broky', 'frozen', 'EliGE'] },
        { id: uid(), name: 'Team Spirit', short: 'SPR', country: 'RU', region: 'EU', points: 735, move: 1, roster: ['chopper', 'donk', 'sh1ro', 'zont1x', 'magixx'] },
        { id: uid(), name: 'G2 Esports', short: 'G2', country: 'DE', region: 'EU', points: 698, move: -2, roster: ['HooXi', 'NiKo', 'm0NESY', 'huNter', 'Brehze'] },
        { id: uid(), name: 'MOUZ', short: 'MOZ', country: 'GB', region: 'EU', points: 654, move: 0, roster: ['Torsi', 'xertioN', 'Jimpphat', 'Brollan', 'Spinx'] },
        { id: uid(), name: 'The MongolZ', short: 'MLZ', country: 'MN', region: 'AS', points: 621, move: 3, roster: ['bLitz', 'Technik', 'mzinho', 'Senzu', '910'] },
        { id: uid(), name: 'Astralis', short: 'AST', country: 'DK', region: 'EU', points: 588, move: -1, roster: ['HUNDEN', 'device', 'stabbleF', 'jabbi', 'Staehr'] }
      ],
      players: [
        { id: uid(), nick: 'ZywOo', realName: 'Mathieu Herbaut', country: 'FR', age: 25, role: 'awp', rating: 1.32, photo: '', history: [{ team: 'Vitality', period: 'Dec 2018 — Present' }] },
        { id: uid(), nick: 'apEX', realName: 'Dan Madesclaire', country: 'FR', age: 33, role: 'igl', rating: 1.05, photo: '', history: [{ team: 'Vitality', period: 'Dec 2018 — Present' }, { team: 'G2 Esports', period: 'Jul 2016 — Nov 2018' }] },
        { id: uid(), nick: 'donk', realName: 'Danil Kryshkovets', country: 'RU', age: 19, role: 'rifler', rating: 1.28, photo: '', history: [{ team: 'Team Spirit', period: 'Dec 2023 — Present' }] },
        { id: uid(), nick: 'b1t', realName: 'Valerii Vakhovskyi', country: 'UA', age: 25, role: 'rifler', rating: 1.11, photo: '', history: [{ team: 'Natus Vincere', period: 'Aug 2021 — Present' }] },
        { id: uid(), nick: 'm0NESY', realName: 'Ilya Osipov', country: 'RU', age: 21, role: 'awp', rating: 1.21, photo: '', history: [{ team: 'G2 Esports', period: 'Jun 2023 — Present' }, { team: 'Team Spirit', period: 'Aug 2021 — May 2023' }] },
        { id: uid(), nick: 'karrigan', realName: 'Finn Andersen', country: 'DK', age: 35, role: 'igl', rating: 0.98, photo: '', history: [{ team: 'FaZe Clan', period: 'Jan 2021 — Present' }] }
      ],
      events: [
        { id: uid(), name: 'CCT Season 3 European Series', location: 'Онлайн, Европа', prize: '$250,000', start: daysFromNow(-6), end: daysFromNow(2), status: 'running', teams: 16 },
        { id: uid(), name: 'BLAST Open Fall', location: 'Лиссабон, Португалия', prize: '$1,100,000', start: daysFromNow(9), end: daysFromNow(20), status: 'upcoming', teams: 12 },
        { id: uid(), name: 'IEm Cologne', location: 'Кёльн, Германия', prize: '$1,000,000', start: daysFromNow(-58), end: daysFromNow(-49), status: 'finished', teams: 24 },
        { id: uid(), name: 'PGL Astana', location: 'Астана, Казахстан', prize: '$625,000', start: daysFromNow(31), end: daysFromNow(38), status: 'upcoming', teams: 16 }
      ],
      matches: [
        { id: uid(), teamA: 'NAVI', teamB: 'Vitality', scoreA: 2, scoreB: 1, map: 'Mirage 13:11, Nuke 8:13, Anubis 13:9', event: 'CCT Season 3', date: daysFromNow(-1, 19), status: 'finished' },
        { id: uid(), teamA: 'FaZe Clan', teamB: 'MOUZ', scoreA: 1, scoreB: 1, map: 'Inferno 13:10, Overpass 9:13', event: 'CCT Season 3', date: daysFromNow(0, Math.max(0, new Date().getHours())), status: 'live' },
        { id: uid(), teamA: 'Spirit', teamB: 'G2', scoreA: null, scoreB: null, map: '', event: 'CCT Season 3', date: daysFromNow(0, 21), status: 'upcoming' },
        { id: uid(), teamA: 'The MongolZ', teamB: 'Astralis', scoreA: null, scoreB: null, map: '', event: 'CCT Season 3', date: daysFromNow(1, 15), status: 'upcoming' },
        { id: uid(), teamA: 'Vitality', teamB: 'FaZe Clan', scoreA: null, scoreB: null, map: '', event: 'BLAST Open Fall', date: daysFromNow(10, 17), status: 'upcoming' },
        { id: uid(), teamA: 'NAVI', teamB: 'Spirit', scoreA: null, scoreB: null, map: '', event: 'BLAST Open Fall', date: daysFromNow(12, 20), status: 'upcoming' },
        { id: uid(), teamA: 'G2', teamB: 'Astralis', scoreA: 2, scoreB: 0, map: 'Dust2 13:7, Mirage 13:11', event: 'IEm Cologne', date: daysFromNow(-55, 18), status: 'finished' }
      ],
      news: [
        {
          id: uid(),
          title: 'NAVI выигрывают серию против Vitality и проходят в финал верхней сетки',
          excerpt: 'Решающая карта закончилась со счётом 13:9 на Anubis — команда закрыла серию 2:1.',
          body: 'Серия началась на Mirage, где NAVI забрали раунд за раундом к счёту 13:11. Vitality ответили на Nuke и уверенно провели вторую половину.\n\nНа Anubis всё решила разница в один раунд в середине второй половины: NAVI забрали pistol и выигдали серию 2:1.\n\nСледующий матч команда сыграет против победителя пары Spirit — G2. Дата и время будут объявлены позже.',
          tags: ['NAVI', 'Vitality', 'CCT Season 3'],
          author: 'redactor',
          date: daysFromNow(-1, 21),
          image: ''
        },
        {
          id: uid(),
          title: 'Состав The MongolZ подтверждён на BLAST Open Fall',
          excerpt: 'Организация опубликовала ростер за неделю до старта турнира в Лиссабоне.',
          body: 'Команда приедет тем же составом, что играла последние два турнира. Замен не планируется.\n\nПо словам менеджера, команда прилетает на LAN за три дня до старта, чтобы отработать сеттинг и тренировочные серверы.\n\nГрупповой этап стартует на следующей неделе.',
          tags: ['The MongolZ', 'BLAST Open Fall'],
          author: 'redactor',
          date: daysFromNow(-2, 14),
          image: ''
        },
        {
          id: uid(),
          title: 'FaZe Clan объявили о подписании запасного игрока',
          excerpt: 'Игрок будет стоять на замене до конца осеннего сезона.',
          body: 'Клуб подписал запасного игрока на случай болезни или буткемпа основного состава.\n\nРуководство отметило, что игрок уже тренируется с командой и готов выйти на сервер в ближайшем матче.',
          tags: ['FaZe Clan'],
          author: 'redactor',
          date: daysFromNow(-3, 11),
          image: ''
        }
      ]
    };
    data.brackets = exampleBrackets(data);
    return data;
  }

  const Store = {
    KINDS,
    uid,
    admin,
    winnerOf,
    loserOf,
    propagate,
    records,
    pairSwiss,
    emptySlot,
    normalizeBracket,
    buildRounds,
    thirdAllowed,
    SWISS_GROUPS,
    SWISS_COLS,
    swissCol,
    playerRecord,
    playerView,
    playerHistory,
    teamOfNick,
    rosterPlayers,
    benchPlayers,
    benchList,
    allPlayers,
    realNick,
    state: read(),
    reload() { this.state = read(); return this.state; },
    list(kind) { return this.state[kind] || []; },
    find(kind, id) { return this.list(kind).find((x) => x.id === id) || null; },
    bracketFor(eventId) { return this.list('brackets').find((b) => b.eventId === eventId) || null; },
    isEmpty() { return KINDS.every((k) => this.list(k).length === 0); },
    broken() { return broken; },
    /* True while what is on screen is the shipped demo snapshot, not somebody's own base. */
    seedDemo() { return seedUsed && !!(global.CLUTCH_SEED && global.CLUTCH_SEED.demo); },
    save() { return write(this.state); },
    add(kind, obj) {
      const item = Object.assign({ id: uid() }, obj);
      this.state[kind].push(item);
      return write(this.state) ? item : null;
    },
    update(kind, id, patch) {
      const item = this.find(kind, id);
      if (!item) return null;
      Object.assign(item, patch);
      return write(this.state) ? item : null;
    },
    remove(kind, id) {
      this.state[kind] = this.list(kind).filter((x) => x.id !== id);
      return write(this.state);
    },
    loadExample() { this.state = example(); write(this.state, true); return this.state; },
    clear() { this.state = empty(); write(this.state, true); return this.state; },
    importText(text) {
      const parsed = JSON.parse(text);
      const next = empty();
      KINDS.forEach((k) => {
        if (Array.isArray(parsed[k])) next[k] = parsed[k].map((item) => Object.assign({ id: uid() }, item));
      });
      next.brackets = next.brackets.map(safeNormalize);
      this.state = next;
      write(this.state, true);
      return next;
    }
  };

  global.Store = Store;
})(window);
