/* Shared chrome + rendering for all content pages. */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const param = (name) => new URLSearchParams(location.search).get(name);

  const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const pad = (n) => String(n).padStart(2, '0');

  function fmtDateTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }
  function rel(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    const diff = Date.now() - d.getTime();
    const min = Math.round(diff / 60000);
    if (min < 1) return 'только что';
    if (min < 60) return `${min} мин назад`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} ч назад`;
    const days = Math.round(h / 24);
    if (days < 30) return `${days} дн назад`;
    return fmtDate(iso);
  }
  function countdown(iso) {
    const ms = new Date(iso).getTime() - Date.now();
    if (isNaN(ms) || ms <= 0) return null;
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return d > 0 ? `${d} д ${h} ч` : `${h} ч ${m} мин`;
  }

  /* ---- sorted views ---- */
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    return m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  };

  const byDateDesc = (a, b) => new Date(b.date) - new Date(a.date);
  const byDateAsc = (a, b) => new Date(a.date) - new Date(b.date);

  const Views = {
    news() { return Store.list('news').slice().sort(byDateDesc); },
    matches() {
      const all = Store.list('matches');
      const active = all.filter((m) => m.status !== 'finished').sort(byDateAsc);
      const done = all.filter((m) => m.status === 'finished').sort(byDateDesc);
      return active.concat(done);
    },
    teams() { return Store.list('teams').slice().sort((a, b) => (b.points || 0) - (a.points || 0)); },
    players() { return Store.allPlayers(); },
    bench() { return Store.benchList(); },
    events() {
      const all = Store.list('events');
      const live = all.filter((e) => e.status !== 'finished').sort((a, b) => new Date(a.start) - new Date(b.start));
      const past = all.filter((e) => e.status === 'finished').sort((a, b) => new Date(b.start) - new Date(a.start));
      return live.concat(past);
    }
  };

  /* ---- components ---- */
  function matchStatus(m) {
    if (m.status === 'live') return '<span class="badge live">Live</span>';
    if (m.status === 'upcoming') return '<span class="badge upcoming">Скоро</span>';
    return '<span class="badge done">Завершён</span>';
  }

  function newsRow(item) {
    const thumb = item.image
      ? `<div class="thumb"><img src="${esc(item.image)}" alt=""></div>`
      : '<div class="thumb">CLUTCH<br>.TV</div>';
    return `<article class="news-item">
      ${thumb}
      <div>
        <h3><a href="article.html?id=${esc(item.id)}">${esc(item.title)}</a></h3>
        <p class="excerpt">${esc(item.excerpt)}</p>
        <div class="meta"><span>${rel(item.date)}</span><span>${fmtDateTime(item.date)}</span><span>${esc(item.author || 'redactor')}</span></div>
      </div>
    </article>`;
  }

  function matchesTable(list, opts) {
    if (!list.length) return emptyBlock('Матчей пока нет', 'Добавьте результат или анонс в админке.', opts);
    const withEvent = !(opts && opts.hideEvent);
    const rows = list.map((m) => {
      const cd = m.status === 'upcoming' ? countdown(m.date) : null;
      const score = (m.status === 'upcoming' || m.status === 'live') && m.scoreA == null
        ? '<span class="score">vs</span>'
        : `<span class="score ${m.scoreA > m.scoreB ? 'win' : ''}">${m.scoreA == null ? '-' : m.scoreA}</span> : <span class="score ${m.scoreB > m.scoreA ? 'win' : ''}">${m.scoreB == null ? '-' : m.scoreB}</span>`;
      return `<tr>
        <td class="num">${fmtDateTime(m.date)}${cd ? `<br><small class="meta">через ${cd}</small>` : ''}</td>
        ${withEvent ? `<td>${eventCell(m.event)}</td>` : ''}
        <td>${teamName(m.teamA)} ${score} ${teamName(m.teamB)}<br><small class="meta">${esc(m.map || '')}</small></td>
        <td>${matchStatus(m)}</td>
      </tr>`;
    }).join('');
    return `<table class="tbl"><thead><tr>
        <th class="num">Время</th>${withEvent ? '<th>Турнир</th>' : ''}<th>Противостояние</th><th>Статус</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  }

  function teamsTable(list, limit, opts) {
    if (!list.length) return emptyBlock('Рейтинга пока нет', 'Добавьте команды в админке — таблица соберётся сама.', opts);
    const rows = list.slice(0, limit || list.length).map((t, i) => {
      const mv = t.move > 0 ? `<span class="move-up">▲ ${t.move}</span>`
        : t.move < 0 ? `<span class="move-down">▼ ${Math.abs(t.move)}</span>`
        : '<span class="meta">=</span>';
      return `<tr>
        <td class="pos">${i + 1}</td>
        <td>${teamName(t.name)}${t.short && t.short !== t.name ? ` <small class="meta">${esc(t.short)}</small>` : ''}</td>
        <td>${esc(t.country || '—')}</td>
        <td>${esc(t.region || '—')}</td>
        <td>${(t.roster || []).map((n) => Store.realNick(n) ? playerLink(n) : esc(n)).join(', ') || '—'}</td>
        <td class="num">${t.points == null ? '—' : t.points}</td>
        <td class="num">${mv}</td>
      </tr>`;
    }).join('');
    return `<table class="tbl"><thead><tr>
        <th>#</th><th>Команда</th><th>Страна</th><th>Регион</th><th>Состав</th><th class="num">Рейтинг</th><th class="num">±</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  }

  /* Match rows keep the tournament as free text, so compare names both ways. */
  function eventByName(name) {
    const want = String(name || '').toLowerCase().trim();
    if (!want) return null;
    return Store.list('events').find((e) => {
      const has = String(e.name || '').toLowerCase().trim();
      return has === want || has.includes(want) || want.includes(has);
    }) || null;
  }

  const eventCell = (name) => {
    const found = eventByName(name);
    return found ? `<span class="team"><a href="event.html?id=${esc(found.id)}">${esc(name)}</a></span>`
      : esc(name || '—');
  };

  /* ---- profiles ---- */
  /* Teams are typed as free text in matches and brackets, so a profile link is resolved from the ranking. */
  const nickKey = (s) => String(s == null ? '' : s).toLowerCase().trim();
  const toks = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').split(' ').filter(Boolean);
  function teamRecord(text) {
    const want = String(text == null ? '' : text).toLowerCase().trim();
    if (!want) return null;
    const teams = Store.list('teams');
    const exact = teams.find((t) => String(t.name).toLowerCase().trim() === want || String(t.short || '').toLowerCase().trim() === want);
    if (exact) return exact;
    const words = toks(want);
    return teams.find((t) => {
      const hay = toks(t.name).concat(toks(t.short));
      return !!words.length && words.every((w) => hay.indexOf(w) >= 0);
    }) || null;
  }
  const sameTeam = (a, b) => {
    const x = teamRecord(a), y = teamRecord(b);
    return !!x && !!y && x.id === y.id;
  };
  const teamName = (text) => {
    const found = teamRecord(text);
    return found ? `<a class="team" href="team.html?id=${esc(found.id)}">${esc(text)}</a>`
      : `<span class="team">${esc(text)}</span>`;
  };
  const playerLink = (nick) => `<a href="player.html?p=${encodeURIComponent(String(nick || ''))}">${esc(nick)}</a>`;

  const ROLE_LABEL = { awp: 'Снайпер', rifler: 'Стрелок', support: 'Поддержка', igl: 'Капитан', reserve: 'Запасной', coach: 'Тренер' };

  function matchesWithTeam(text) {
    return Views.matches().filter((m) => sameTeam(m.teamA, text) || sameTeam(m.teamB, text));
  }
  function bracketsWithTeam(text) {
    return Store.list('brackets').filter((b) => (b.rounds || []).some((r) => (r.slots || []).some((s) => (s.a && sameTeam(s.a, text)) || (s.b && sameTeam(s.b, text)))));
  }
  function newsAbout(terms) {
    const want = terms.filter(Boolean).map((s) => String(s).toLowerCase().trim()).filter((s) => s.length > 2);
    return Views.news().filter((n) => {
      const hay = `${n.title} ${n.excerpt} ${n.body} ${(n.tags || []).join(' ')}`.toLowerCase();
      return want.some((w) => hay.indexOf(w) >= 0);
    });
  }

  /* Wins and losses counted from finished matches of this team. */
  function teamStats(text) {
    const done = matchesWithTeam(text).filter((m) => m.status === 'finished' && m.scoreA != null && m.scoreB != null);
    const score = (m) => {
      const mine = sameTeam(m.teamA, text) ? Number(m.scoreA) : Number(m.scoreB);
      const other = sameTeam(m.teamA, text) ? Number(m.scoreB) : Number(m.scoreA);
      return mine > other ? 1 : mine < other ? -1 : 0;
    };
    const sorted = done.slice().sort(byDateDesc);
    let streak = 0;
    sorted.forEach((m) => {
      const s = score(m);
      if (streak >= 0 && s === 1) streak++;
      else if (streak <= 0 && s === -1) streak--;
    });
    const w = done.filter((m) => score(m) === 1).length;
    const l = done.filter((m) => score(m) === -1).length;
    return { played: done.length, w, l, rate: done.length ? Math.round((w / done.length) * 100) : null, streak };
  }

  /* What a team ended up with in one bracket: decided places first, then the round it dropped out of. */
  function placementIn(b, text) {
    const champ = championOf(b);
    if (champ && sameTeam(champ, text)) return '1-е место · чемпион';
    const tp = roundByKey(b, 'TP');
    if (tp && tp.slots[0] && sameTeam(Store.winnerOf(tp.slots[0]), text)) return '3-е место';
    const gf = roundByKey(b, 'GF') || roundByKey(b, 'F');
    if (gf && gf.slots[0]) {
      const s = gf.slots[0];
      const played = (s.a && sameTeam(s.a, text)) || (s.b && sameTeam(s.b, text));
      const win = Store.winnerOf(s);
      if (played && win && !sameTeam(win, text)) return '2-е место';
      if (played && !win) return 'Играет финал';
    }
    if ((b.type || 'single') === 'swiss') {
      const key = (b.rounds || []).reduce((all, r) => all.concat((r.slots || []).reduce((acc, s) => {
        [s.a, s.b].forEach((t) => { if (t && sameTeam(t, text) && acc.indexOf(t) < 0) acc.push(t); });
        return acc;
      }, [])), []).filter(Boolean)[0];
      const rec = key ? Store.records(b)[key] : null;
      if (!rec) return 'Выступает';
      if (rec.w >= 3) return `Выход в плей-офф (${rec.w}-${rec.l})`;
      if (rec.l >= 3) return `Вылет (${rec.w}-${rec.l})`;
      return `Швейцарка ${rec.w}-${rec.l}`;
    }
    let exit = null;
    let plays = false;
    (b.rounds || []).forEach((r) => {
      if (r.side === 'third') return;
      (r.slots || []).forEach((s) => {
        if (!((s.a && sameTeam(s.a, text)) || (s.b && sameTeam(s.b, text)))) return;
        plays = true;
        const win = Store.winnerOf(s);
        if (win && !sameTeam(win, text)) exit = r;
      });
    });
    if (exit) return `Вылет в «${exit.name || exit.key}»`;
    return plays ? 'Выступает' : 'Участие';
  }

  function eventsList(list, limit, opts) {
    if (!list.length) return emptyBlock('Турниров пока нет', 'Добавьте ивент в админке.', opts);
    return list.slice(0, limit || list.length).map((e) => {
      const badge = e.status === 'running' ? '<span class="badge live">Идёт</span>'
        : e.status === 'upcoming' ? '<span class="badge upcoming">Скоро</span>'
        : '<span class="badge done">Завершён</span>';
      return `<div class="list-row">
        <div><b><a href="event.html?id=${esc(e.id)}">${esc(e.name)}</a></b><br><small class="meta">${esc(e.location || '—')} · призовые ${esc(e.prize || '—')} · ${e.teams || 0} команд<br>${fmtDate(e.start)} — ${fmtDate(e.end)}</small></div>
        <div class="who">${badge}</div>
      </div>`;
    }).join('');
  }

  function emptyBlock(title, text, opts) {
    if (opts && opts.cta === false) {
      return `<div class="empty"><b>${esc(title)}</b>${esc(text)}</div>`;
    }
    return `<div class="empty"><b>${esc(title)}</b>${esc(text)}<br><br>
      <a class="btn primary" href="admin.html">Открыть админку</a></div>`;
  }

  /* ---- page chrome ---- */
  /* The editor lives in the source folder: a published copy, or anything opened from dist/, shows no admin links. */
  const editable = () => Store.admin.ok()
    || (location.protocol === 'file:' && !/(^|\/)dist\//i.test(location.pathname));
  const NAV = [
    ['index.html', 'home', 'Главная'],
    ['news.html', 'news', 'Новости'],
    ['matches.html', 'matches', 'Матчи'],
    ['rankings.html', 'rankings', 'Рейтинг'],
    ['events.html', 'events', 'Турниры'],
    ['bracket.html', 'brackets', 'Сетки'],
    ['players.html', 'players', 'Игроки'],
    ['bench.html', 'bench', 'Запас'],
    ['admin.html', 'admin', 'Админка']
  ];

  function renderChrome(active) {
    const header = document.getElementById('chrome-header');
    /* A published copy has no editor in it, so its links stay hidden unless the admin key opened this session. */
    document.body.classList.toggle('no-admin', !editable());
    if (!header) return;
    header.className = 'topbar';
    header.innerHTML = `<div class="wrap">
      <a class="logo" href="index.html">CLUTCH<span>.TV</span></a>
      <span class="tagline">Counter-Strike · новости, матчи, рейтинг</span>
      <nav class="main">${NAV.map(([href, key, label]) =>
        `<a href="${href}" class="${key === (active === 'event' ? 'events' : active) ? 'active' : ''}">${label}</a>`).join('')}</nav>
      <form class="search" action="news.html">
        <input type="search" name="q" placeholder="Поиск новостей" value="${esc(param('q') || '')}">
      </form>
    </div>`;

    const footer = document.getElementById('chrome-footer');
    if (footer) {
      footer.className = 'site';
      footer.innerHTML = `<div class="wrap">
        <span>CLUTCH.TV — сайт о Counter-Strike. Не связан с HLTV.org.</span>
        ${Store.seedDemo() ? '<span>Данные сейчас демонстрационные — их заполняет владелец сайта.</span>' : ''}
        <span>Обновлено: ${Store.state.updatedAt ? fmtDateTime(Store.state.updatedAt) : '—'}</span>
      </div>`;
    }

    const mount = document.getElementById('content');
    if (Store.broken() && mount && editable()) {
      mount.insertAdjacentHTML('afterbegin', `<div class="notice err">
        <span>Сохранённые данные не читаются (${esc(String(Store.broken()))}) — сайт показывает пустую базу и не перезаписывает её. Вернуть всё можно импортом из файла.</span>
        <span><a class="btn primary" href="admin.html?tab=data">Импортировать резервную копию</a></span>
      </div>`);
    }
    /* Служебные плашки показываем только тому, кто может их починить: на публичной копии их нет. */
    if (Store.isEmpty() && mount && active !== 'admin' && editable()) {
      mount.insertAdjacentHTML('afterbegin', `<div class="notice">
        <span>В базе пока пусто — страницы выглядят пустыми.</span>
        <span>
          <button class="btn" data-act="seed">Загрузить примеры</button>
          <a class="btn primary" href="admin.html">Добавить своё</a>
        </span>
      </div>`);
    }
  }

  /* ---- pages ---- */
  /* Two brackets can share a name — the tab adds the tournament, then the format, then the size until they differ. */
  function bracketLabel(all, b) {
    const nameOf = (x) => x.name || TYPE_LABEL[x.type || 'single'];
    const n = nameOf(b);
    const same = all.filter((x) => nameOf(x) === n);
    if (same.length < 2) return n;
    const evOf = (x) => { const e = Store.find('events', x.eventId); return e ? e.name : ''; };
    if (new Set(same.map(evOf)).size > 1) return `${n} · ${evOf(b) || 'без турнира'}`;
    if (new Set(same.map((x) => x.type || 'single')).size > 1) return `${n} · ${TYPE_LABEL[b.type || 'single']}`;
    return `${n} · ${Number(b.size) || 8} команд`;
  }

  /* Tabs over the board: every bracket of the site is a tab, the picked one opens below. */
  function bracketPanel(all, current) {
    const chips = all.map((b) => `<a class="chip${b.id === current.id ? ' on' : ''}" href="?bracket=${esc(b.id)}">${esc(bracketLabel(all, b))}</a>`).join('');
    return `<div class="panel"><header>Скобки <a href="bracket.html">все сетки →</a></header><div class="body">
      <p class="tabs">${chips}</p>
      <p class="hint">${esc(BRACKET_HINT[current.type || 'single'])}</p>
    </div></div>${bracketBlock(current, Store.find('events', current.eventId))}`;
  }

  function pageHome() {
    const news = Views.news();
    const matches = Views.matches();
    const live = matches.filter((m) => m.status === 'live');
    const upcoming = matches.filter((m) => m.status === 'upcoming');
    const next = upcoming.slice(0, 5);
    const teams = Views.teams();
    const events = Views.events();
    const brackets = Store.list('brackets');
    const picked = brackets.find((b) => b.id === param('bracket')) || brackets[0] || null;

    document.getElementById('content').innerHTML = `<div class="cols">
      <main>
        ${news.length ? `<div class="panel"><header>Главное</header>
          <div class="headline">
            <h2><a href="article.html?id=${esc(news[0].id)}">${esc(news[0].title)}</a></h2>
            <p>${esc(news[0].excerpt)}</p>
            <div class="meta"><span>${rel(news[0].date)}</span><span>${esc(news[0].author || 'redactor')}</span></div>
          </div></div>` : `<div class="panel"><header>Главное</header>${emptyBlock('Новостей нет', 'Добавьте первую новость — она появится здесь.')}</div>`}

        <div class="panel"><header>Последние новости <a href="news.html">все →</a></header>
          ${news.slice(1, 6).map(newsRow).join('') || '<div class="empty">Пока больше ничего нет.</div>'}
        </div>

        <div class="panel"><header>Ближайшие матчи <a href="matches.html">все →</a></header>${matchesTable(next)}</div>

        ${picked ? `<div class="page-title"><h2>Скобки</h2><p>${brackets.length} ${plural(brackets.length, 'сетка', 'сетки', 'сеток')}</p></div>${bracketPanel(brackets, picked)}` : ''}
      </main>

      <aside>
        <div class="panel"><header>Сейчас в эфире</header>
          ${live.length ? live.map((m) => `<div class="list-row"><div>${teamName(m.teamA)} · ${teamName(m.teamB)}<br><small class="meta">${esc(m.map || m.event || '')}</small></div><div class="who">${matchStatus(m)}</div></div>`).join('')
          : '<div class="empty">Live-матчей нет.</div>'}
        </div>
        <div class="panel"><header>Топ-8 рейтинга <a href="rankings.html">все →</a></header>${teamsTable(teams, 8, { cta: false })}</div>
        <div class="panel"><header>Турниры <a href="events.html">все →</a></header>${eventsList(events, 4, { cta: false })}</div>
      </aside>
    </div>`;
  }

  function pageNews() {
    const raw = (param('q') || '').trim();
    const q = raw.toLowerCase();
    let list = Views.news();
    if (q) list = list.filter((n) => (n.title + ' ' + n.excerpt + ' ' + n.body + ' ' + (n.tags || []).join(' ')).toLowerCase().includes(q));
    document.getElementById('content').innerHTML = `<div class="cols">
      <main>
        <div class="page-title"><h1>${raw ? `Поиск: ${esc(raw)}` : 'Новости'}</h1><p>${list.length} записей</p></div>
        <div class="panel">${list.map(newsRow).join('') || emptyBlock('Ничего не найдено', 'Попробуйте другой запрос или добавьте новость в админке.')}</div>
        ${q ? '<p class="hint"><a href="news.html">Сбросить поиск</a></p>' : ''}
      </main>
      <aside>
        <div class="panel"><header>Ближайшие матчи</header>${matchesTable(Views.matches().filter((m) => m.status === 'upcoming').slice(0, 4), { cta: false })}</div>
        <div class="panel"><header>Топ-6 рейтинга</header>${teamsTable(Views.teams(), 6, { cta: false })}</div>
      </aside>
    </div>`;
  }

  function pageMatches() {
    const all = Views.matches();
    const filter = param('f') || 'all';
    const event = param('event') || '';
    const norm = (s) => String(s || '').toLowerCase().trim();
    const wanted = norm(event);
    const sameEvent = (name) => {
      const has = norm(name);
      return !!wanted && (has === wanted || has.includes(wanted) || wanted.includes(has));
    };
    const byEvent = wanted ? all.filter((m) => sameEvent(m.event)) : all;
    const list = filter === 'all' ? byEvent : byEvent.filter((m) => m.status === filter);
    const chip = (key, label) => {
      const query = [];
      if (key !== 'all') query.push('f=' + key);
      if (event) query.push('event=' + encodeURIComponent(event));
      return `<a class="btn small ${filter === key ? 'primary' : ''}" href="matches.html${query.length ? '?' + query.join('&') : ''}">${label}</a>`;
    };
    const bracket = wanted ? Store.list('brackets').find((b) => {
      const e = Store.find('events', b.eventId);
      return e && sameEvent(e.name);
    }) : null;
    document.getElementById('content').innerHTML = `<div class="cols">
      <main>
        <div class="page-title"><h1>${event ? `Матчи: ${esc(event)}` : 'Матчи'}</h1><p>${byEvent.length} в выборке · ${all.length} всего</p></div>
        <p class="tabs">${chip('all', 'Все')} ${chip('live', 'Live')} ${chip('upcoming', 'Анонсы')} ${chip('finished', 'Результаты')}
          ${event ? `<a class="btn small" href="matches.html">Все турниры</a>` : ''}
          ${bracket ? `<a class="btn small" href="bracket.html?bracket=${esc(bracket.id)}">Сетка турнира →</a>` : ''}</p>
        <div class="panel"><header>Расписание и результаты</header>${matchesTable(list)}</div>
      </main>
      <aside>
        <div class="panel"><header>Турниры</header>${eventsList(Views.events(), 6, { cta: false })}</div>
        <div class="panel"><header>Топ-6 рейтинга</header>${teamsTable(Views.teams(), 6, { cta: false })}</div>
      </aside>
    </div>`;
  }

  function pageRankings() {
    const teams = Views.teams();
    const total = teams.reduce((sum, t) => sum + (t.points || 0), 0);
    document.getElementById('content').innerHTML = `<div class="cols">
      <main>
        <div class="page-title"><h1>Рейтинг команд</h1><p>сортировка по рейтингу · ${teams.length} команд</p></div>
        <div class="panel"><header>Мировой топ</header>${teamsTable(teams)}</div>
      </main>
      <aside>
        <div class="panel"><header>Сводка</header><div class="body">
          <div class="list-row"><span>Команд в рейтинге</span><b>${teams.length}</b></div>
          <div class="list-row"><span>Суммарный рейтинг</span><b>${total}</b></div>
          <div class="list-row"><span>Средний рейтинг</span><b>${teams.length ? Math.round(total / teams.length) : 0}</b></div>
          <div class="list-row"><span>Лидер</span><b>${teams[0] ? esc(teams[0].name) : '—'}</b></div>
        </div></div>
        <div class="panel"><header>Ростеры</header><div class="body">
          ${teams.slice(0, 6).map((t) => `<p class="hint">${teamName(t.name)} — ${(t.roster || []).map((n) => Store.realNick(n) ? playerLink(n) : esc(n)).join(', ') || 'состав не указан'}</p>`).join('') || '<p class="hint">Команд пока нет.</p>'}
        </div></div>
      </aside>
    </div>`;
  }

  function pageEvents() {
    const events = Views.events();
    const rows = events.length ? `<table class="tbl"><thead><tr>
        <th>Турнир</th><th>Место</th><th>Даты</th><th class="num">Команд</th><th class="num">Призовые</th><th>Статус</th><th>Сетка</th>
      </tr></thead><tbody>${events.map((e) => {
        const b = Store.bracketFor(e.id);
        return `<tr>
        <td><span class="team"><a href="event.html?id=${esc(e.id)}">${esc(e.name)}</a></span></td>
        <td>${esc(e.location || '—')}</td>
        <td>${fmtDate(e.start)} — ${fmtDate(e.end)}</td>
        <td class="num">${e.teams || 0}</td>
        <td class="num">${esc(e.prize || '—')}</td>
        <td>${e.status === 'running' ? '<span class="badge live">Идёт</span>' : e.status === 'upcoming' ? '<span class="badge upcoming">Скоро</span>' : '<span class="badge done">Завершён</span>'}</td>
        <td>${b ? `<a href="bracket.html?bracket=${esc(b.id)}">${esc(b.name || 'плей-офф')} →</a>` : `<a href="admin.html?newbracket=${esc(e.id)}">создать</a>`}</td>
      </tr>`; }).join('')}</tbody></table>` : emptyBlock('Турниров пока нет', 'Добавьте ивент в админке.');
    document.getElementById('content').innerHTML = `<div class="cols">
      <main>
        <div class="page-title"><h1>Турниры</h1><p>${events.length} в базе</p></div>
        <div class="panel"><header>Сезон</header>${rows}</div>
      </main>
      <aside>
        <div class="panel"><header>Матчи этих турниров</header>${matchesTable(Views.matches().filter((m) => m.status !== 'finished').slice(0, 5), { cta: false })}</div>
        <div class="panel"><header>Топ-6 рейтинга</header>${teamsTable(Views.teams(), 6, { cta: false })}</div>
      </aside>
    </div>`;
  }

  function eventBadge(status) {
    return status === 'running' ? '<span class="badge live">Идёт</span>'
      : status === 'upcoming' ? '<span class="badge upcoming">Скоро</span>'
      : '<span class="badge done">Завершён</span>';
  }

  function pageEvent() {
    const mount = document.getElementById('content');
    const event = param('id') ? Store.find('events', param('id')) : null;
    document.title = (event ? event.name : 'Турнир') + ' — CLUTCH.TV';
    if (!event) {
      mount.innerHTML = `<div class="cols"><main>
        <div class="panel"><header>Турнир</header>${emptyBlock('Турнир не найден', 'Ссылка устарела или запись удалили в админке. Список турниров — в разделе «Турниры».')}</div>
      </main></div>`;
      return;
    }
    const norm = (s) => String(s || '').toLowerCase().trim();
    const want = norm(event.name);
    const lead = want.split(' ').slice(0, 2).join(' ');
    const brackets = Store.list('brackets').filter((b) => b.eventId === event.id);
    const shown = brackets.filter((b) => b.onEvent !== false);
    const hidden = brackets.length - shown.length;
    const allWanted = param('all') === '1';
    const picked = param('bracket') ? shown.find((b) => b.id === param('bracket')) : null;
    const current = picked || shown[0] || null;
    const eventLink = 'event.html?id=' + encodeURIComponent(event.id);
    const matches = Views.matches().filter((m) => {
      const has = norm(m.event);
      return !!has && (has === want || has.includes(want) || want.includes(has));
    });
    const news = Views.news().filter((n) => {
      const text = norm(n.title + ' ' + n.excerpt + ' ' + n.body + ' ' + (n.tags || []).join(' '));
      return text.includes(want) || (lead.length > 5 && text.includes(lead));
    });
    const upcoming = matches.filter((m) => m.status === 'upcoming');
    /* A tournament can have only a Swiss or only a double bracket — offer the plain playoff it is missing. */
    const hasPlayoff = brackets.some((b) => (b.type || 'single') === 'single');
    const buttons = `<p class="tabs">
        <a class="btn" href="matches.html?event=${encodeURIComponent(event.name)}">Все матчи турнира</a>
        <a class="btn" href="admin.html?tab=matches">Добавить матч</a>
        <a class="btn" href="admin.html?tab=brackets${brackets.length ? '' : '&newbracket=' + encodeURIComponent(event.id)}">${brackets.length ? 'Все сетки сайта' : 'Создать сетку'}</a>
        ${brackets.length && !hasPlayoff ? `<a class="btn primary" href="admin.html?tab=brackets&quickplayoff=${encodeURIComponent(event.id)}">Добавить плей-офф</a>` : ''}
        <a class="btn" href="admin.html?tab=events">Редактировать турнир</a>
      </p>`;
    const chips = shown.map((b) => `<a class="chip${!allWanted && b.id === current.id ? ' on' : ''}" href="${eventLink}&amp;bracket=${encodeURIComponent(b.id)}">${esc(bracketLabel(shown, b))}</a>`).join('')
      + (shown.length > 1 ? `<a class="chip${allWanted ? ' on' : ''}" href="${eventLink}&amp;all=1">Все сетки</a>` : '');
    const bracketsBlock = !shown.length
      ? `<div class="panel"><header>Сетки</header>${emptyBlock(hidden ? 'Показ всех сеток выключен' : 'Сетки пока нет', hidden ? 'Во вкладке «Сетки» админки у сетки есть переключатель «Показывать на странице турнира».' : 'Создайте сетку этого турнира — она появится здесь и в разделе «Сетки».', { cta: false })}</div>`
      : `<div class="panel"><header>Скобки ${hidden ? `<span class="hint">скрыто ${hidden} из ${brackets.length}</span>` : ''}</header><div class="body">
          <p class="tabs">${chips}</p>
          <p class="hint">${esc(BRACKET_HINT[current.type || 'single'])}</p>
        </div></div>`
        + (allWanted ? shown.map((b) => bracketBlock(b, event)).join('') : bracketBlock(current, event));

    mount.innerHTML = `<div class="cols">
      <main>
        <div class="page-title"><h1>${esc(event.name)}</h1><p>${fmtDate(event.start)} — ${fmtDate(event.end)}</p></div>
        ${buttons}
        <div class="panel"><header>О турнире ${eventBadge(event.status)}</header><div class="body">
          <div class="list-row"><span>Место</span><b>${esc(event.location || '—')}</b></div>
          <div class="list-row"><span>Призовые</span><b>${esc(event.prize || '—')}</b></div>
          <div class="list-row"><span>Команд в сетке</span><b>${event.teams || 0}</b></div>
          <div class="list-row"><span>Даты</span><b>${fmtDate(event.start)} — ${fmtDate(event.end)}</b></div>
          <div class="list-row"><span>Матчей в базе</span><b>${matches.length}</b></div>
          <div class="list-row"><span>Сеток на странице</span><b>${shown.length}${hidden ? ` (ещё ${hidden} скрыто)` : ''}</b></div>
        </div></div>
        ${bracketsBlock}
        <div class="panel"><header>Матчи турнира <a href="matches.html?event=${encodeURIComponent(event.name)}">все →</a></header>${matchesTable(matches, { cta: false })}</div>
        <div class="panel"><header>Новости по турниру</header>${news.length ? news.map(newsRow).join('') : '<div class="empty">Новостей с этим названием пока нет.</div>'}</div>
      </main>
      <aside>
        ${shown.length ? `<div class="panel"><header>Сетки этого турнира</header>${shown.map((b) => `<div class="list-row${!allWanted && b.id === current.id ? ' on' : ''}"><div><b>${esc(b.name || TYPE_LABEL[b.type || 'single'])}</b><br><small class="meta">${esc(TYPE_LABEL[b.type || 'single'])}</small></div><div class="who"><a href="${eventLink}&amp;bracket=${encodeURIComponent(b.id)}">смотреть</a> · <a href="bracket.html?bracket=${esc(b.id)}">отдельно →</a></div></div>`).join('')}</div>` : ''}
        <div class="panel"><header>Ближайшие матчи</header>${matchesTable(upcoming.slice(0, 3), { cta: false, hideEvent: true })}</div>
        <div class="panel"><header>Другие турниры</header>${eventsList(Views.events().filter((e) => e.id !== event.id), 5, { cta: false })}</div>
        <div class="panel"><header>Топ-6 рейтинга</header>${teamsTable(Views.teams(), 6, { cta: false })}</div>
      </aside>
    </div>`;
  }

  function pageArticle() {
    const id = param('id');
    const item = id ? Store.find('news', id) : null;
    const all = Views.news();
    const mount = document.getElementById('content');
    if (!item) {
      mount.innerHTML = `<div class="cols"><main><div class="panel"><header>Новость</header>
        ${emptyBlock('Новость не найдена', 'Возможно, её удалили в админке или ссылка устарела.')}</div></main>
        <aside><div class="panel"><header>Свежее</header>${all.slice(0, 5).map(newsRow).join('') || '<div class="empty">Пусто.</div>'}</div></aside></div>`;
      return;
    }
    const idx = all.findIndex((n) => n.id === item.id);
    const prev = all[idx + 1];
    const next = all[idx - 1];
    const paragraphs = String(item.body || '').split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
    mount.innerHTML = `<div class="cols">
      <main class="panel"><header>Новость</header><div class="body article">
        <h1>${esc(item.title)}</h1>
        <div class="meta"><span>${fmtDateTime(item.date)}</span><span>${rel(item.date)}</span><span>Автор: ${esc(item.author || 'redactor')}</span></div>
        ${item.image ? `<p><img src="${esc(item.image)}" alt="" style="max-width:100%;border-radius:6px;border:1px solid var(--line)"></p>` : ''}
        ${item.excerpt ? `<h2>${esc(item.excerpt)}</h2>` : ''}
        <div class="body-text">${paragraphs || '<p class="hint">Текст новости пуст — добавьте его в админке.</p>'}</div>
        <div class="tags">${(item.tags || []).map((t) => `<a class="tag" href="news.html?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div>
        <p class="tabs">
          ${prev ? `<a class="btn small" href="article.html?id=${esc(prev.id)}">← ${esc(prev.title).slice(0, 40)}</a>` : ''}
          ${next ? `<a class="btn small" href="article.html?id=${esc(next.id)}">${esc(next.title).slice(0, 40)} →</a>` : ''}
          <a class="btn small" href="news.html">Все новости</a>
          <a class="btn small" href="admin.html?edit=${esc(item.id)}">Редактировать</a>
        </p>
      </div></main>
      <aside>
        <div class="panel"><header>Читают сейчас</header>${all.filter((n) => n.id !== item.id).slice(0, 5).map(newsRow).join('') || '<div class="empty">Больше новостей нет.</div>'}</div>
        <div class="panel"><header>Ближайшие матчи</header>${matchesTable(Views.matches().filter((m) => m.status === 'upcoming').slice(0, 3), { cta: false })}</div>
      </aside>
    </div>`;
  }

  /* ---- team profile ---- */
  const TEAM_TABS = [['roster', 'Состав'], ['matches', 'Матчи'], ['events', 'Турниры'], ['results', 'Достижения'], ['news', 'Новости']];

  function teamLogo(team) {
    return team.logo
      ? `<img class="logo-img" src="${esc(team.logo)}" alt="">`
      : crest(team.name, true);
  }

  function pageTeam() {
    const mount = document.getElementById('content');
    const team = param('id') ? Store.find('teams', param('id')) : null;
    document.title = (team ? team.name : 'Команда') + ' — CLUTCH.TV';
    if (!team) {
      mount.innerHTML = `<div class="cols"><main><div class="panel"><header>Команда</header><div class="body">
        ${emptyBlock('Команда не найдена', 'Запись удалили из рейтинга, или ссылка устарела.', { cta: false })}
        <p class="tabs"><a class="btn" href="rankings.html">Рейтинг команд</a><a class="btn" href="players.html">Все игроки</a></p>
      </div></div></main></div>`;
      return;
    }
    const roster = Store.rosterPlayers(team);
    const stats = teamStats(team.name);
    const boards = bracketsWithTeam(team.name);
    const played = matchesWithTeam(team.name);
    const upcoming = played.filter((m) => m.status !== 'finished');
    const news = newsAbout([team.name, team.short]);
    const place = Views.teams().findIndex((t) => t.id === team.id) + 1;
    const ages = roster.map((p) => Number(p.rec && p.rec.age)).filter((x) => x);
    const current = TEAM_TABS.some(([k]) => k === param('tab')) ? param('tab') : 'roster';
    const href = (key) => `team.html?id=${encodeURIComponent(team.id)}&tab=${key}`;
    const mv = team.move > 0 ? `<span class="move-up">▲ ${team.move}</span>`
      : team.move < 0 ? `<span class="move-down">▼ ${Math.abs(team.move)}</span>` : '<span class="meta">без изменений</span>';

    const panels = {
      roster: roster.length
        ? `<table class="tbl"><thead><tr><th>Игрок</th><th>Настоящее имя</th><th>Роль</th><th class="num">Возраст</th><th class="num">Рейтинг</th></tr></thead><tbody>
            ${roster.map((p) => `<tr>
              <td>${playerLink(p.nick)}${p.rec ? '' : ' <small class="meta">профиль пуст</small>'}</td>
              <td>${esc((p.rec && p.rec.realName) || '—')}</td>
              <td>${esc(p.rec && p.rec.role ? (ROLE_LABEL[p.rec.role] || p.rec.role) : '—')}</td>
              <td class="num">${p.rec && p.rec.age ? esc(p.rec.age) : '—'}</td>
              <td class="num">${p.rec && p.rec.rating ? esc(p.rec.rating) : '—'}</td>
            </tr>`).join('')}</tbody></table>`
        : '<div class="empty"><b>Состав не указан</b>Впишите никнеймы в поле «Игроки» у команды — профили соберутся сами.</div>',
      matches: matchesTable(played, { cta: false }),
      events: boards.length ? boards.map((b) => {
        const e = Store.find('events', b.eventId);
        return `<div class="list-row">
          <div><b>${e ? `<a href="event.html?id=${esc(e.id)}">${esc(e.name)}</a>` : 'Турнир не привязан'}</b><br>
            <small class="meta">${esc(bracketLabel(boards, b))} · ${esc(TYPE_LABEL[b.type || 'single'])} · ${e ? fmtDate(e.start) + ' — ' + fmtDate(e.end) : '—'}</small></div>
          <div class="who"><a href="bracket.html?bracket=${esc(b.id)}">сетка →</a></div>
        </div>`;
      }).join('') : '<div class="empty"><b>В сетках не замечена</b>Добавьте команду в сетку турнира — турниры появятся здесь.</div>',
      results: boards.length ? `<table class="tbl"><thead><tr><th>Турнир</th><th>Сетка</th><th>Итог</th></tr></thead><tbody>
          ${boards.map((b) => {
            const e = Store.find('events', b.eventId);
            const placeText = placementIn(b, team.name);
            return `<tr><td>${e ? `<a href="event.html?id=${esc(e.id)}">${esc(e.name)}</a>` : '—'}</td>
              <td>${esc(b.name || TYPE_LABEL[b.type || 'single'])}</td>
              <td><b class="${placeText.indexOf('чемпион') >= 0 ? 'move-up' : ''}">${esc(placeText)}</b></td></tr>`;
          }).join('')}</tbody></table>`
        : '<div class="empty"><b>Достижений пока нет</b>Они считаются сами из сеток, где команда сыграла хотя бы один матч.</div>',
      news: news.length ? news.map(newsRow).join('') : '<div class="empty"><b>Новостей нет</b>Новость найдётся здесь, если в заголовке, тексте или тегах будет название команды.</div>'
    };

    mount.innerHTML = `<div class="cols">
      <main>
        <div class="panel"><header>Профиль команды</header><div class="body profile">
          ${teamLogo(team)}
          <div class="profile-main">
            <h1>${esc(team.name)}</h1>
            <div class="meta"><span>${esc(team.short || '—')}</span><span>${esc(team.country || '—')}</span><span>регион ${esc(team.region || '—')}</span></div>
          </div>
          <div class="profile-nums">
            <div class="pnum"><b>${team.points == null ? '—' : esc(team.points)}</b><span>рейтинг</span></div>
            <div class="pnum"><b>${place || '—'}</b><span>место</span></div>
            <div class="pnum"><b>${stats.rate == null ? '—' : stats.rate + '%'}</b><span>выиграно</span></div>
          </div>
        </div></div>
        <p class="tabs">${TEAM_TABS.map(([k, label]) => `<a class="chip${k === current ? ' on' : ''}" href="${href(k)}">${label}</a>`).join('')}
          <a class="chip" href="admin.html?tab=teams&edit=${encodeURIComponent(team.id)}">Редактировать</a></p>
        <div class="panel"><header>${TEAM_TABS.find(([k]) => k === current)[1]}</header><div class="body">${panels[current]}</div></div>
      </main>
      <aside>
        <div class="panel"><header>О команде</header><div class="body">
          <div class="list-row"><span>Рейтинг</span><b>${team.points == null ? '—' : esc(team.points)}</b></div>
          <div class="list-row"><span>Место в рейтинге</span><b>${place || '—'}</b></div>
          <div class="list-row"><span>Изменение позиции</span><b>${mv}</b></div>
          <div class="list-row"><span>Игроков в составе</span><b>${roster.length}</b></div>
          <div class="list-row"><span>Средний возраст</span><b>${ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : '—'}</b></div>
          <div class="list-row"><span>Матчей сыграно</span><b>${stats.played}</b></div>
          <div class="list-row"><span>Сетка</span><b>${stats.w} — ${stats.l}</b></div>
        </div></div>
        <div class="panel"><header>Ближайшие матчи <a href="${href('matches')}">все →</a></header>${matchesTable(upcoming.slice(0, 3), { cta: false, hideEvent: false })}</div>
        <div class="panel"><header>Игроки</header><div class="body"><p class="tabs">
          ${roster.map((p) => `<a class="chip" href="player.html?p=${encodeURIComponent(p.nick)}">${esc(p.nick)}</a>`).join('') || '<span class="hint">Состав не указан.</span>'}
        </p></div></div>
        <div class="panel"><header>Другие команды <a href="rankings.html">рейтинг →</a></header>${teamsTable(Views.teams().filter((t) => t.id !== team.id), 5, { cta: false })}</div>
      </aside>
    </div>`;
  }

  /* ---- player profile ---- */
  const PLAYER_TABS = [['info', 'Профиль'], ['teams', 'История составов'], ['results', 'Достижения'], ['matches', 'Матчи'], ['news', 'Новости']];

  function pagePlayer() {
    const mount = document.getElementById('content');
    const view = Store.playerView(param('p'));
    document.title = (view ? view.nick : 'Игрок') + ' — CLUTCH.TV';
    if (!view) {
      mount.innerHTML = `<div class="cols"><main><div class="panel"><header>Игрок</header><div class="body">
        ${emptyBlock('Игрок не найден', 'Такого никнейма нет ни в одном составе, ни во вкладке «Игроки».', { cta: false })}
        <p class="tabs"><a class="btn" href="players.html">Список игроков</a><a class="btn" href="rankings.html">Рейтинг команд</a></p>
      </div></div></main></div>`;
      return;
    }
    const rec = view.rec || {};
    const team = view.team;
    const href = (key) => `player.html?p=${encodeURIComponent(view.nick)}&tab=${key}`;
    const current = PLAYER_TABS.some(([k]) => k === param('tab')) ? param('tab') : 'info';
    const history = Store.playerHistory(rec);
    const boards = team ? bracketsWithTeam(team.name) : [];
    const played = team ? matchesWithTeam(team.name) : [];
    const upcoming = played.filter((m) => m.status !== 'finished');
    const results = played.filter((m) => m.status === 'finished').slice(0, 5);
    const news = newsAbout([view.nick]);
    const country = rec.country || (team && team.country) || '';
    const teammates = team ? Store.rosterPlayers(team).filter((p) => nickKey(p.nick) !== nickKey(view.nick)) : [];

    const rows = [];
    if (rec.realName) rows.push(['Настоящее имя', esc(rec.realName)]);
    if (country) rows.push(['Страна', esc(country)]);
    if (rec.age) rows.push(['Возраст', esc(rec.age)]);
    if (rec.role) rows.push(['Роль', esc(ROLE_LABEL[rec.role] || rec.role)]);
    if (rec.rating) rows.push(['Рейтинг 2.0', esc(rec.rating)]);

    const panels = {
      info: `<div class="body">
        ${rows.length ? rows.map(([k, v]) => `<div class="list-row"><span>${k}</span><b>${v}</b></div>`).join('')
          : `<div class="empty"><b>Профиль пуст</b>${editable()
            ? 'Заполните ник, имя, роль и рейтинг во вкладке «Игроки» — поля появятся здесь.'
            : 'Владелец сайта ещё не заполнил этот профиль.'}</div>`}
      </div>`,
      teams: history.length ? `<table class="tbl"><thead><tr><th>Период</th><th>Команда</th></tr></thead><tbody>
          ${history.map((row) => `<tr><td>${esc(row.period || '—')}</td><td>${row.team ? teamName(row.team) : '—'}</td></tr>`).join('')}
        </tbody></table>`
        : `<div class="empty"><b>История пуста</b>${editable()
          ? 'Добавьте строки вида «Команда | Oct 2026 — Present» во вкладке «Игроки».'
          : 'Владелец сайта ещё не заполнял историю составов.'}</div>`,
      results: boards.length ? `<table class="tbl"><thead><tr><th>Турнир</th><th>Сетка</th><th>Итог</th></tr></thead><tbody>
          ${boards.map((b) => {
            const e = Store.find('events', b.eventId);
            const placeText = placementIn(b, team.name);
            return `<tr><td>${e ? `<a href="event.html?id=${esc(e.id)}">${esc(e.name)}</a>` : '—'}</td>
              <td>${esc(b.name || TYPE_LABEL[b.type || 'single'])}</td><td>${esc(placeText)}</td></tr>`;
          }).join('')}</tbody></table>`
        : `<div class="empty"><b>Достижений нет</b>${team ? 'Команда ещё не сыграла ни одного матча в сетках.' : 'Игрок без команды — припишите его к составу, и выступления посчитаются.'}</div>`,
      matches: `<div class="body">${matchesTable(upcoming.concat(results), { cta: false })}</div>`,
      news: news.length ? `<div class="body">${news.map(newsRow).join('')}</div>`
        : '<div class="empty"><b>Новостей нет</b>Здесь появятся новости, где никнейм упомянут в заголовке, тексте или тегах.</div>'
    };

    mount.innerHTML = `<div class="cols">
      <main>
        <div class="panel"><header>Профиль игрока</header><div class="body profile">
          ${rec.photo ? `<img class="logo-img" src="${esc(rec.photo)}" alt="">` : (team ? crest(team.name, true) : `<span class="crest big" style="--h:210">${esc(monogram(view.nick))}</span>`)}
          <div class="profile-main">
            <h1>${esc(view.nick)}</h1>
            <div class="meta"><span>${rec.realName ? esc(rec.realName) : 'имя не указано'}</span><span>${country ? esc(country) : '—'}</span>
              <span>${team ? teamName(team.name) : 'свободный агент'}</span></div>
          </div>
          <div class="profile-nums">
            <div class="pnum"><b>${rec.rating ? esc(rec.rating) : '—'}</b><span>рейтинг 2.0</span></div>
            <div class="pnum"><b>${rec.age ? esc(rec.age) : '—'}</b><span>возраст</span></div>
            <div class="pnum"><b>${rec.role ? esc(ROLE_LABEL[rec.role] || rec.role) : '—'}</b><span>роль</span></div>
          </div>
        </div></div>
        <p class="tabs">${PLAYER_TABS.map(([k, label]) => `<a class="chip${k === current ? ' on' : ''}" href="${href(k)}">${label}</a>`).join('')}
          <a class="chip" href="admin.html?tab=players&edit=${encodeURIComponent(view.nick)}">Заполнить профиль</a></p>
        <div class="panel"><header>${PLAYER_TABS.find(([k]) => k === current)[1]}</header>${panels[current]}</div>
      </main>
      <aside>
        ${team ? `<div class="panel"><header>Текущая команда</header><div class="body">
          <div class="list-row"><span>Команда</span><b>${teamName(team.name)}</b></div>
          <div class="list-row"><span>Рейтинг</span><b>${team.points == null ? '—' : esc(team.points)}</b></div>
          <div class="list-row"><span>Регион</span><b>${esc(team.region || '—')}</b></div>
        </div></div>` : ''}
        ${teammates.length ? `<div class="panel"><header>Одноклубники</header><div class="body"><p class="tabs">
          ${teammates.map((p) => `<a class="chip" href="player.html?p=${encodeURIComponent(p.nick)}">${esc(p.nick)}</a>`).join('')}
        </p></div></div>` : ''}
        <div class="panel"><header>Ближайшие матчи команды <a href="${href('matches')}">все →</a></header>${matchesTable(upcoming.slice(0, 3), { cta: false })}</div>
        <div class="panel"><header>Последние результаты</header>${matchesTable(results, { cta: false })}</div>
      </aside>
    </div>`;
  }

  /* ---- all players ---- */
  function pagePlayers() {
    const mount = document.getElementById('content');
    document.title = 'Игроки — CLUTCH.TV';
    const all = Views.players();
    const regions = [];
    all.forEach((p) => { const r = p.team && p.team.region; if (r && regions.indexOf(r) < 0) regions.push(r); });
    const region = param('region') || '';
    const raw = (param('q') || '').trim();
    const q = raw.toLowerCase();
    const shown = all.filter((p) => {
      if (region && !(p.team && p.team.region === region)) return false;
      if (!q) return true;
      return p.nick.toLowerCase().indexOf(q) >= 0
        || String((p.rec && p.rec.realName) || '').toLowerCase().indexOf(q) >= 0
        || String(p.team ? p.team.name : '').toLowerCase().indexOf(q) >= 0;
    });
    const filled = all.filter((p) => p.rec).length;

    const table = shown.length ? `<table class="tbl"><thead><tr>
        <th>Игрок</th><th>Команда</th><th>Регион</th><th>Роль</th><th class="num">Возраст</th><th class="num">Рейтинг</th>
      </tr></thead><tbody>${shown.map((p) => `<tr>
        <td>${playerLink(p.nick)}</td>
        <td>${p.team ? teamName(p.team.name) : '<span class="meta">свободный агент</span>'}</td>
        <td>${esc((p.team && p.team.region) || '—')}</td>
        <td>${p.rec && p.rec.role ? esc(ROLE_LABEL[p.rec.role] || p.rec.role) : '—'}</td>
        <td class="num">${p.rec && p.rec.age ? esc(p.rec.age) : '—'}</td>
        <td class="num">${p.rec && p.rec.rating ? esc(p.rec.rating) : '—'}</td>
      </tr>`).join('')}</tbody></table>`
      : emptyBlock(all.length ? 'Никого не нашлось' : 'Игроков пока нет',
        all.length ? 'Попробуйте другой ник или снимите фильтр по региону.' : 'Профили собираются из составов команд: добавьте никнеймы командам в рейтинге.', { cta: false });

    mount.innerHTML = `<div class="cols">
      <main>
        <div class="page-title"><h1>Игроки</h1><p>${all.length} никнеймов в составах · профилей заполнено ${filled}</p></div>
        <p class="tabs">${regions.map((r) => `<a class="chip${r === region ? ' on' : ''}" href="players.html?region=${encodeURIComponent(r)}">${esc(r)}</a>`).join('')}
          ${region ? '<a class="chip" href="players.html">Все регионы</a>' : ''}</p>
        <div class="panel"><header>Список${region ? ' · ' + esc(region) : ''}${raw ? ' · поиск «' + esc(raw) + '»' : ''}</header>${table}</div>
      </main>
      <aside>
        <div class="panel"><header>Поиск</header><div class="body">
          <form class="search" action="players.html"><input type="search" name="q" placeholder="Ник, имя или команда" value="${esc(raw)}"></form>
        </div></div>
        <div class="panel"><header>Игроки без заполненного профиля</header><div class="body">
          <p class="hint">Никнейм уже является профилем: страница открывается из любого места, где виден ник. Имя, роль, возраст и рейтинг добавляются в админке во вкладке «Игроки».</p>
        </div></div>
        <div class="panel"><header>Команды <a href="rankings.html">рейтинг →</a></header>${teamsTable(Views.teams(), 6, { cta: false })}</div>
      </aside>
    </div>`;
  }

  /* ---- bench of teams ---- */
  function pageBench() {
    const mount = document.getElementById('content');
    document.title = 'Запас команд — CLUTCH.TV';
    const rows = Views.bench();
    const count = rows.reduce((n, row) => n + row.players.length, 0);

    const list = rows.length ? rows.map((row) => `<div class="panel">
        <header>${teamName(row.team.name)}<small class="meta">${esc([row.team.short, row.team.region].filter(Boolean).join(' · '))}</small></header>
        <table class="tbl"><thead><tr><th>Игрок</th><th>Роль</th><th class="num">Возраст</th><th class="num">Рейтинг</th></tr></thead>
        <tbody>${row.players.map((p) => `<tr>
          <td>${playerLink(p.nick)}</td>
          <td>${p.rec && p.rec.role ? esc(ROLE_LABEL[p.rec.role] || p.rec.role) : 'запасной'}</td>
          <td class="num">${p.rec && p.rec.age ? esc(p.rec.age) : '—'}</td>
          <td class="num">${p.rec && p.rec.rating ? esc(p.rec.rating) : '—'}</td>
        </tr>`).join('')}</tbody></table>
      </div>`).join('')
      : emptyBlock('Запаса нет ни у одной команды',
        'Никнеймы запаса пишутся в админке в карточке команды, в поле «Запас через запятую». Здесь они появятся списком по командам.', { cta: false });

    mount.innerHTML = `<div class="cols">
      <main>
        <div class="page-title"><h1>Запас команд</h1><p>${count} ${plural(count, 'игрок', 'игрока', 'игроков')} вне основных составов · ${rows.length} ${plural(rows.length, 'команда', 'команды', 'команд')}</p></div>
        ${list}
      </main>
      <aside>
        <div class="panel"><header>Откуда берётся запас</header><div class="body">
          <p class="hint">Основной состав и запас — две разные строки команды. Игрок из запаса числится за командой, его ник ведёт на обычный профиль, но в состав матча он не попадает.</p>
        </div></div>
        <div class="panel"><header>Связанные страницы</header><div class="body">
          <p class="tabs"><a class="btn" href="players.html">Все игроки</a><a class="btn" href="rankings.html">Рейтинг команд</a></p>
        </div></div>
      </aside>
    </div>`;
  }

  /* ---- brackets ---- */
  const TYPE_LABEL = { single: 'Сетка с выбыванием', double: 'Сетка с нижней сеткой', swiss: 'Швейцарская система' };
  const TYPE_TITLE = {
    single: 'Турнирная сетка с выбыванием после первого поражения',
    double: 'Турнирная сетка с верхней и нижней сеткой',
    swiss: 'Швейцарская система до 3 побед'
  };
  const BRACKET_HINT = {
    single: 'Проигравший вылетает, победитель переходит в следующий раунд автоматически.',
    double: 'Проигравшие в верхней сетке падают в нижнюю — оттуда путь только в гранд-финал.',
    swiss: 'Пары составляются по счёту побед и поражений, три победы дальше, три поражения — вылет.'
  };
  const THIRD_TITLE = 'Матч за 3-е место, решающий исход';

  /* A small monogram: the short tag from the ranking if the team is known, its initials otherwise. */
  const monogram = (text) => {
    const words = String(text).split(/[^\p{L}\p{Nd}]+/u).filter(Boolean);
    const ini = words.map((w) => w[0]).join('');
    return (ini.length >= 2 ? ini : String(text).replace(/[^\p{L}\p{Nd}]/gu, '')).slice(0, 3).toUpperCase();
  };
  function crest(team, big) {
    const name = String(team || '').trim();
    if (!name) return '';
    const norm = name.toLowerCase();
    const known = Store.list('teams').find((t) => String(t.name).toLowerCase() === norm || String(t.short || '').toLowerCase() === norm);
    const code = known && known.short ? String(known.short).replace(/[^\p{L}\p{Nd}]/gu, '').slice(0, 4) : monogram(name);
    let hue = 0;
    for (let i = 0; i < norm.length; i++) hue = (hue * 31 + norm.charCodeAt(i)) % 360;
    return `<span class="crest${big ? ' big' : ''}" style="--h:${hue}">${esc(code)}</span>`;
  }

  function slotBox(s, mark) {
    const win = Store.winnerOf(s);
    const stream = /^https?:\/\//i.test(String(s.stream || '')) ? String(s.stream) : '';
    const row = (team, score) => {
      const lost = !!win && !!team && team !== win;
      const tail = !win || !team ? '' : team === win
        ? (mark && mark.adv ? '<span class="adv">→</span>' : '')
        : (mark && mark.drop ? '<span class="dn">↓</span>' : '');
      return `<div class="row${win && team === win ? ' win' : ''}${lost ? ' lose' : ''}${team ? '' : ' tbd'}">
        <span class="who">${team ? crest(team) : ''}<span class="nm">${team ? teamName(team) : '? TBD'}</span>${tail}</span>
        <span class="sc">${score === null || score === undefined || score === '' ? '' : esc(score)}</span></div>`;
    };
    const head = (s.when || s.bo || s.live || stream)
      ? `<div class="slot-head">${s.live ? '<b class="onair">Live</b>' : ''}${s.when ? `<b>${esc(s.when)}</b>` : ''}${stream ? `<a class="watch" href="${esc(stream)}" target="_blank" rel="noopener">Смотреть ▶</a>` : ''}${s.bo ? `<span class="bo">${esc(s.bo)}</span>` : ''}</div>`
      : '';
    return `<div class="slot${s.live ? ' live' : ''}">${head}${row(s.a, s.sa)}${row(s.b, s.sb)}</div>`;
  }

  const roundByKey = (b, key) => (b.rounds || []).find((r) => r.key === key);

  function championOf(b) {
    const gf = roundByKey(b, 'GF') || roundByKey(b, 'F') || (b.rounds || []).filter((r) => r.side !== 'third').pop();
    return gf && gf.slots && gf.slots[0] ? Store.winnerOf(gf.slots[0]) : null;
  }
  function thirdOf(b) {
    const tp = roundByKey(b, 'TP');
    return tp && tp.slots[0] ? Store.winnerOf(tp.slots[0]) : null;
  }

  /* The winner of a non-final match moves on; the loser of an upper match drops to the lower bracket. */
  const roundMark = (r) => ({ adv: r.side !== 'third' && r.key !== 'F' && r.key !== 'GF', drop: r.side === 'upper' });

  /* Rounds are drawn as columns; matches that feed one match below are wrapped in a pair with connectors. */
  function columns(rounds) {
    return rounds.map((r, i) => {
      const slots = r.slots || [];
      const mark = roundMark(r);
      const plain = i === rounds.length - 1 || slots.length % 2 === 1;
      let body;
      if (plain) body = slots.map((s) => slotBox(s, mark)).join('');
      else {
        body = '';
        for (let k = 0; k < slots.length; k += 2) {
          body += `<div class="pair">${slotBox(slots[k], mark)}${slots[k + 1] ? slotBox(slots[k + 1], mark) : ''}</div>`;
        }
      }
      return `<div class="round"><h3>${esc(r.name || `Раунд ${i + 1}`)}</h3>${body}</div>`;
    }).join('');
  }

  function sideBlock(title, rounds) {
    return `<div class="side"><h3 class="side-title">${esc(title)}</h3><div class="bracket">${columns(rounds)}</div></div>`;
  }

  /* Swiss board has two looks: the compact pair board and the two-line detailed box. */
  const SWISS_MODE_KEY = 'clutch-tv.swissView';
  const swissMode = () => {
    try { return localStorage.getItem(SWISS_MODE_KEY) === 'detailed' ? 'detailed' : 'compact'; } catch (err) { return 'compact'; }
  };

  /* One match on the Swiss board: two crests side by side, score at the right, LIVE tag above. */
  function slotVs(s) {
    const win = Store.winnerOf(s);
    const stream = /^https?:\/\//i.test(String(s.stream || '')) ? String(s.stream) : '';
    const bits = [s.live ? '<b class="onair">Live</b>' : '', s.when ? `<span>${esc(s.when)}</span>` : '',
      s.bo ? `<span>${esc(s.bo)}</span>` : '', stream ? `<a href="${esc(stream)}" target="_blank" rel="noopener">▶</a>` : ''].filter(Boolean);
    const head = bits.length ? `<div class="vmeta">${bits.join('')}</div>` : '';
    const side = (team, won) => `<span class="vteam${won ? ' win' : ''}">${team ? crest(team) : '<span class="q">?</span>'}</span>`;
    const played = [s.sa, s.sb].every((v) => v !== null && v !== undefined && v !== '');
    return `<div class="slot vs${s.live ? ' live' : ''}">${head}<div class="vsrow"><span class="vpair">${side(s.a, win && win === s.a)}${side(s.b, win && win === s.b)}</span>${played ? `<span class="vssc">${esc(s.sa)}:${esc(s.sb)}</span>` : ''}</div></div>`;
  }

  /* Where the winners and the losers of a score group go. Three wins or three losses ends the run, so those blocks have no exits. */
  function swissFeeds(key) {
    const parts = String(key || '').split('-').map(Number);
    if (isNaN(parts[0]) || isNaN(parts[1]) || parts[0] >= 3 || parts[1] >= 3) return '';
    const arrows = [{ dir: 'up', to: (parts[0] + 1) + '-' + parts[1] }, { dir: 'down', to: parts[0] + '-' + (parts[1] + 1) }]
      .filter((a) => Store.SWISS_GROUPS.indexOf(a.to) >= 0);
    if (!arrows.length) return '';
    return `<span class="feeds">${arrows.map((a) => `<i class="${a.dir}" title="${a.dir === 'up' ? 'победители' : 'проигравшие'} → ${a.to.replace('-', ':')}">»»</i>`).join('')}</span>`;
  }

  const swissSources = (key) => {
    const parts = String(key || '').split('-').map(Number);
    return [((parts[0] - 1) + '-' + parts[1]), (parts[0] + '-' + (parts[1] - 1))].filter((k) => Store.SWISS_GROUPS.indexOf(k) >= 0);
  };

  /* The board reads left to right in columns; three wins colour a group green, three losses red. */
  /* How many teams belong in each score group for a bracket of this size. Rounds are played one at a
     time: half of a group wins, half loses, an odd team in it advances without a match. */
  function swissSeats(b) {
    const seats = {};
    Store.SWISS_GROUPS.forEach((k) => { seats[k] = 0; });
    let cur = { '0-0': Math.max(2, Number(b && b.size) || 8) };
    for (let round = 0; round < Store.SWISS_GROUPS.length && Object.keys(cur).length; round++) {
      const next = {};
      Object.keys(cur).forEach((k) => {
        const parts = k.split('-').map(Number);
        const t = cur[k];
        seats[k] = Math.max(seats[k], t);
        if (parts[0] >= 3 || parts[1] >= 3) return;
        const matches = Math.floor(t / 2);
        const up = (parts[0] + 1) + '-' + parts[1];
        const down = parts[0] + '-' + (parts[1] + 1);
        if (Store.SWISS_GROUPS.indexOf(up) >= 0) next[up] = (next[up] || 0) + matches + (t % 2);
        if (Store.SWISS_GROUPS.indexOf(down) >= 0) next[down] = (next[down] || 0) + matches;
      });
      cur = next;
    }
    return seats;
  }

  function swissView(b) {
    const rec = Store.records(b);
    const standings = Object.keys(rec).length
      ? `<table class="tbl"><thead><tr><th>Команда</th><th class="num">Победы</th><th class="num">Поражения</th><th>Статус</th></tr></thead><tbody>
        ${Object.keys(rec).sort((x, y) => rec[y].w - rec[x].w || rec[x].l - rec[y].l).map((team) => `<tr>
          <td><span class="team">${esc(team)}</span></td><td class="num">${rec[team].w}</td><td class="num">${rec[team].l}</td>
          <td>${rec[team].w >= 3 ? '<span class="badge done">Прошла дальше</span>' : rec[team].l >= 3 ? '<span class="badge live">Вылетела</span>' : '<span class="badge upcoming">Играет</span>'}</td>
        </tr>`).join('')}</tbody></table>`
      : '<p class="hint">Результатов пока нет — таблица появится после первого сыгранного матча.</p>';
    const byKey = {};
    (b.rounds || []).forEach((r) => { byKey[r.key] = r; });
    const filled = (b.rounds || []).some((r) => (r.slots || []).some((s) => s.a || s.b));
    const seats = swissSeats(b);
    const groupClass = (key) => {
      const parts = String(key || '').split('-').map(Number);
      return parts[0] >= 3 ? ' qual' : parts[1] >= 3 ? ' out' : '';
    };
    const compact = swissMode() === 'compact';
    const box = compact ? slotVs : slotBox;
    /* Every group is drawn with as many places as the bracket size implies, so an empty column is not a strip of one row. */
    const cells = (r) => {
      const slots = r.slots || [];
      const want = Math.max(slots.length, Math.ceil((seats[r.key] || 0) / 2));
      const list = slots.slice();
      while (list.length < want) list.push(Store.emptySlot());
      if (list.length) return list.map((s) => box(s)).join('');
      return compact
        ? '<div class="slot vs spare"><div class="vsrow"><span class="vpair"><span class="vteam"><span class="q">?</span></span><span class="vteam"><span class="q">?</span></span></span></div></div>'
        : '<div class="slot spare"><div class="row tbd"><span class="who"><span class="q">?</span><span class="nm">матчей нет</span></span></div></div>';
    };
    /* A group is still TBD while the groups feeding it are not finished. Terminal blocks never play, so they don't gate anything. */
    const undecided = (r) => !(r.slots || []).length || (r.slots || []).some((s) => !Store.winnerOf(s));
    const playable = (key) => {
      const parts = String(key || '').split('-').map(Number);
      return parts[0] < 3 && parts[1] < 3;
    };
    const isTbd = (key) => {
      if (key === '0-0') return false;
      const src = swissSources(key).filter(playable).map((k) => byKey[k]).filter(Boolean);
      return src.length > 0 && src.some(undecided);
    };
    const cols = Store.SWISS_COLS.map((keys) => keys.map((k) => byKey[k]).filter(Boolean));
    const odd = (b.rounds || []).filter((r) => Store.SWISS_GROUPS.indexOf(r.key) < 0);
    if (odd.length) cols[cols.length - 1] = cols[cols.length - 1].concat(odd);
    /* Blocks where the run is over are not matches — they list the teams that finished with that record. */
    const termCells = (key) => {
      const parts = String(key).split('-').map(Number);
      const done = Object.keys(rec).filter((t) => (parts[0] >= 3 ? rec[t].w >= 3 && rec[t].l === parts[1] : rec[t].l >= 3 && rec[t].w === parts[0]));
      done.sort((x, y) => rec[y].w - rec[x].w || rec[x].l - rec[y].l);
      let html = done.map((t) => `<span class="tcell">${crest(t)}<b>${esc(t)}</b></span>`).join('');
      for (let i = done.length; i < Math.max(1, seats[key] || 0); i++) html += '<span class="q"></span>';
      return html;
    };
    const groupHtml = (r) => {
      const parts = String(r.key).split('-').map(Number);
      const label = esc(String(r.name || r.key).replace('-', ':'));
      if (parts[0] >= 3 || parts[1] >= 3) {
        return `<div class="swiss-group${groupClass(r.key)}">${swissFeeds(r.key)}<div class="gbody term"><h3>${label}</h3><div class="termgrid">${termCells(r.key)}</div></div></div>`;
      }
      return `<div class="swiss-group"><h3>${label}${isTbd(r.key) ? '<small class="tbdchip">TBD</small>' : ''}</h3>${swissFeeds(r.key)}<div class="gbody">${cells(r)}</div></div>`;
    };
    /* Finished groups of the same kind share a row (3:1 beside 3:2, 1:3 beside 2:3), the way HLTV packs its green and red panels. */
    const bands = (list) => {
      const out = [];
      list.forEach((r) => {
        const parts = String(r.key).split('-').map(Number);
        const kind = parts[0] >= 3 ? 'qual' : parts[1] >= 3 ? 'out' : '';
        const last = out[out.length - 1];
        if (kind && last && last.kind === kind && last.items.length === 1) last.items.push(r);
        else out.push({ kind, items: [r] });
      });
      return out;
    };
    /* Bands step down the column; the column itself spreads them so every column ends up the same height. */
    const board = cols.filter((c) => c.length).map((c) => `<div class="swiss-col">${bands(c)
      .map((band) => `<div class="swiss-band${band.items.length > 1 ? ' two' : ''}">${band.items.map(groupHtml).join('')}</div>`)
      .join('')}</div>`).join('');
    return `<div class="body board-tools"><p class="tabs"><button data-act="swiss-mode">${compact ? 'Детальный вид' : 'Краткий вид'}</button>
      <span class="hint">Зелёные стрелки — победители идут вверх по счёту, красные — проигравшие падают вниз.</span></p></div>
      <div class="swiss ${compact ? 'compact' : 'detailed'}">${board}</div>
      ${filled ? '' : `<div class="body"><p class="hint">Матчей ещё нет — колодка <b>0-0</b> это первый круг. Заполните их в <a href="admin.html?bracket=${esc(b.id)}">админке</a>: «Добавить матч» вписывает пары вручную, «Перезагрузить пары» или «Высшее семя» расставляют команды сами.</p></div>`}
      <div class="body"><h3>Таблица</h3>${standings}</div>`;
  }

  function bracketView(b) {
    const rounds = b.rounds || [];
    if (b.type === 'swiss') return swissView(b);
    const third = rounds.filter((r) => r.side === 'third');
    if (b.type === 'double') {
      return sideBlock('Верхний кронштейн', rounds.filter((r) => r.side === 'upper'))
        + sideBlock('Нижний кронштейн', rounds.filter((r) => r.side === 'lower').concat(rounds.filter((r) => r.side === 'final')))
        + (third.length ? sideBlock(THIRD_TITLE, third) : '');
    }
    return `<div class="bracket">${columns(rounds.filter((r) => r.side !== 'third'))}</div>`
      + (third.length ? sideBlock(THIRD_TITLE, third) : '');
  }

  function bracketBlock(bracket, event) {
    const champ = championOf(bracket);
    const third = thirdOf(bracket);
    return `<details class="panel" open>
      <summary>${event ? `<a href="event.html?id=${esc(event.id)}">${esc(event.name)}</a> · ` : 'Сетка без турнира · '
        }${esc(bracket.name || 'Плей-офф')} <span class="badge">${esc(TYPE_TITLE[bracket.type || 'single'])}</span></summary>
      ${bracketView(bracket)}
      <div class="body">
        ${champ ? `<p><b>Победитель:</b> <span class="team">${esc(champ)}</span></p>` : ''}
        ${third ? `<p><b>3-е место:</b> <span class="team">${esc(third)}</span></p>` : ''}
        <p class="tabs">
          ${event ? `<a class="btn small" href="matches.html?event=${encodeURIComponent(event.name)}">Матчи турнира</a>` : ''}
          <a class="btn small" href="admin.html?bracket=${esc(bracket.id)}">Редактировать сетку</a>
          <a class="btn small" href="bracket.html?bracket=${esc(bracket.id)}">Сетка отдельной страницей</a>
        </p>
      </div></details>`;
  }

  function pageBrackets() {
    const all = Store.list('brackets');
    const mount = document.getElementById('content');
    if (!all.length) {
      mount.innerHTML = `<div class="cols"><main>
        <div class="page-title"><h1>Скобки</h1><p>0 турниров с сеткой</p></div>
        <div class="panel"><header>Сетка</header>${emptyBlock('Сеток пока нет', 'Создайте сетку для турнира во вкладке «Сетки» админки — она появится здесь.')}</div>
      </main></div>`;
      return;
    }
    const current = all.find((b) => b.id === param('bracket')) || all.find((b) => b.eventId === param('event')) || all[0];
    const rows = all.map((b) => {
      const e = Store.find('events', b.eventId);
      const champ = championOf(b);
      return `<div class="list-row">
        <div><b>${esc(b.name || TYPE_LABEL[b.type || 'single'])}</b><br><small class="meta">${e ? `<a href="event.html?id=${esc(e.id)}">${esc(e.name)}</a>` : 'без турнира'} · ${champ ? `победитель ${esc(champ)}` : 'играется'}</small></div>
        <div class="who"><a href="bracket.html?bracket=${esc(b.id)}">открыть →</a></div>
      </div>`;
    }).join('');

    mount.innerHTML = `<div class="cols">
      <main>
        <div class="page-title"><h1>Скобки</h1><p>${all.length} ${plural(all.length, 'сетка', 'сетки', 'сеток')}</p></div>
        ${bracketPanel(all, current)}
      </main>
      <aside>
        <div class="panel"><header>Все сетки</header>${rows}</div>
        <div class="panel"><header>Топ-6 рейтинга</header>${teamsTable(Views.teams(), 6, { cta: false })}</div>
      </aside>
    </div>`;
  }

  const ROUTES = { home: pageHome, news: pageNews, matches: pageMatches, rankings: pageRankings, events: pageEvents, event: pageEvent, article: pageArticle, brackets: pageBrackets, team: pageTeam, player: pagePlayer, players: pagePlayers, bench: pageBench };

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act="seed"]');
    if (!btn) return;
    e.preventDefault();
    Store.loadExample();
    location.reload();
  });

  /* Compact board <-> detailed board, remembered between visits. */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act="swiss-mode"]');
    if (!btn) return;
    e.preventDefault();
    try { localStorage.setItem(SWISS_MODE_KEY, swissMode() === 'compact' ? 'detailed' : 'compact'); } catch (err) { /* private mode */ }
    const route = ROUTES[document.body.dataset.page];
    if (route) route();
  });

  window.App = { esc, param, fmtDate, fmtDateTime, rel, countdown, Views, renderChrome, ROUTES, newsRow, editable };

  const active = document.body.dataset.page;
  if (ROUTES[active]) ROUTES[active]();
  renderChrome(active);
  setInterval(() => { if (ROUTES[active]) ROUTES[active](); }, 60000);
})();
