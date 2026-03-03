import { Hono } from 'hono';

export const observerRouter = new Hono();

const observerHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Hive Observer</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@500&display=swap');

    :root {
      --bg: #f4f8fb;
      --bg-soft: #eaf2f8;
      --surface: #ffffff;
      --ink: #17212b;
      --ink-muted: #617084;
      --line: #d4dee8;
      --brand: #0b7f88;
      --brand-2: #026c75;
      --ok: #1c9b53;
      --warn: #c67d0e;
      --bad: #bb2f2f;
      --pending: #50647d;
      --shadow: 0 14px 32px rgba(21, 39, 56, 0.08);
      --radius: 14px;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: 'Manrope', sans-serif;
      color: var(--ink);
      background:
        radial-gradient(1200px 600px at -20% -10%, #d7ecf9 0%, transparent 55%),
        radial-gradient(900px 500px at 110% 10%, #d8f4ef 0%, transparent 56%),
        var(--bg);
      min-height: 100vh;
    }

    .app {
      max-width: 1400px;
      margin: 0 auto;
      padding: 24px;
      display: grid;
      gap: 16px;
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 14px;
    }

    .header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      flex-wrap: wrap;
    }

    h1 {
      margin: 0;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 1.5rem;
      letter-spacing: -0.02em;
    }

    .muted { color: var(--ink-muted); }

    .filters {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    }

    label {
      font-size: 0.8rem;
      color: var(--ink-muted);
      margin-bottom: 4px;
      display: block;
    }

    select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px;
      font: inherit;
      background: #fff;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
    }

    .pill {
      border-radius: 999px;
      padding: 3px 9px;
      font-size: 0.75rem;
      font-weight: 700;
      background: var(--bg-soft);
      color: var(--ink);
      display: inline-block;
    }

    .agent-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 10px;
    }

    .agent-card {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px;
      background: linear-gradient(180deg, #fff 0%, #f8fbfd 100%);
    }

    .split {
      display: grid;
      grid-template-columns: 1.2fr 1fr;
      gap: 14px;
    }

    .list {
      display: grid;
      gap: 8px;
      max-height: 430px;
      overflow: auto;
      padding-right: 2px;
    }

    .row {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px;
      background: #fff;
      cursor: pointer;
    }

    .row:hover { border-color: #b6c6d8; }
    .row.active { border-color: var(--brand); background: #f1fbfc; }

    .mono {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.78rem;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      line-height: 1.35;
      background: #f6f9fc;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px;
      max-height: 340px;
      overflow: auto;
    }

    .timeline-item, .log-item {
      border-left: 3px solid var(--line);
      padding: 8px 10px;
      margin-bottom: 8px;
      background: #fff;
      border-radius: 0 10px 10px 0;
    }

    .timeline-item.event { border-left-color: var(--brand); }
    .timeline-item.post { border-left-color: var(--pending); }
    .log-item.ok { border-left-color: var(--ok); }
    .log-item.fail { border-left-color: var(--bad); }

    .empty, .error {
      padding: 12px;
      border-radius: 10px;
      border: 1px dashed var(--line);
      color: var(--ink-muted);
      background: #fbfdff;
    }

    .error {
      border-style: solid;
      border-color: #f1c4c4;
      background: #fff5f5;
      color: #8c1d1d;
    }

    @media (max-width: 980px) {
      .split { grid-template-columns: 1fr; }
      .app { padding: 14px; }
    }
  </style>
</head>
<body>
  <div class="app">
    <section class="card header">
      <div>
        <h1>Hive Observer</h1>
        <div class="muted">Read-only operations visibility for mentions, rooms, and webhook delivery.</div>
      </div>
      <div class="muted" id="last-refresh">Loading...</div>
    </section>

    <section class="card">
      <div class="filters">
        <div>
          <label for="agent-filter">Agent</label>
          <select id="agent-filter"></select>
        </div>
        <div>
          <label for="room-filter">Room</label>
          <select id="room-filter"></select>
        </div>
        <div>
          <label for="status-filter">Status</label>
          <select id="status-filter">
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div>
          <label for="range-filter">Time range</label>
          <select id="range-filter">
            <option value="1h">Last hour</option>
            <option value="24h" selected>Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="all">All time</option>
          </select>
        </div>
      </div>
    </section>

    <section class="card">
      <h3>Dashboard</h3>
      <div class="stats" id="dashboard-totals"></div>
      <div class="agent-grid" id="dashboard-agents"></div>
    </section>

    <section class="card split">
      <div>
        <h3>Mentions</h3>
        <div id="mentions-list" class="list"></div>
      </div>
      <div>
        <h3>Mention Detail</h3>
        <div id="mention-detail" class="empty">Pick a mention to inspect output and timestamps.</div>
      </div>
    </section>

    <section class="card split">
      <div>
        <h3>Room Timeline</h3>
        <div id="timeline-list" class="list"></div>
      </div>
      <div>
        <h3>Webhook Delivery Log</h3>
        <div id="webhook-list" class="list"></div>
      </div>
    </section>
  </div>

  <script>
    const state = {
      filters: { agent: 'all', room: 'all', status: 'all', range: '24h' },
      mentions: [],
      activeMentionId: null,
      selectedAgentForList: null,
    };

    const refs = {
      lastRefresh: document.getElementById('last-refresh'),
      agentFilter: document.getElementById('agent-filter'),
      roomFilter: document.getElementById('room-filter'),
      statusFilter: document.getElementById('status-filter'),
      rangeFilter: document.getElementById('range-filter'),
      dashboardTotals: document.getElementById('dashboard-totals'),
      dashboardAgents: document.getElementById('dashboard-agents'),
      mentionsList: document.getElementById('mentions-list'),
      mentionDetail: document.getElementById('mention-detail'),
      timelineList: document.getElementById('timeline-list'),
      webhookList: document.getElementById('webhook-list'),
    };

    function sinceFromRange(range) {
      const now = Date.now();
      if (range === '1h') return now - (60 * 60 * 1000);
      if (range === '24h') return now - (24 * 60 * 60 * 1000);
      if (range === '7d') return now - (7 * 24 * 60 * 60 * 1000);
      if (range === '30d') return now - (30 * 24 * 60 * 60 * 1000);
      return null;
    }

    function fmtTime(value) {
      if (!value) return '-';
      return new Date(value).toLocaleString();
    }

    function statusPill(status) {
      return '<span class="pill">' + status + '</span>';
    }

    async function requestJson(url) {
      const response = await fetch(url);
      const body = await response.json();
      if (!response.ok || body.success === false) {
        throw new Error(body.error || ('Request failed: ' + response.status));
      }
      return body;
    }

    function setSelectOptions(select, items, allLabel) {
      const prev = select.value;
      select.innerHTML = '<option value="all">' + allLabel + '</option>' + items.map((item) => (
        '<option value="' + item.value + '">' + item.label + '</option>'
      )).join('');
      select.value = items.some((item) => item.value === prev) ? prev : 'all';
    }

    async function loadMeta() {
      const [agentsRes, roomsRes] = await Promise.all([
        requestJson('/agents'),
        requestJson('/rooms'),
      ]);

      const agents = (agentsRes.agents || []).map((a) => ({ value: a.id, label: a.name + ' (' + a.id + ')' }));
      const rooms = (roomsRes.data || []).map((r) => ({ value: r.id, label: r.name + ' (' + r.id + ')' }));
      setSelectOptions(refs.agentFilter, agents, 'All agents');
      setSelectOptions(refs.roomFilter, rooms, 'All rooms');
    }

    function queryParams() {
      const params = new URLSearchParams();
      if (state.filters.room !== 'all') params.set('roomId', state.filters.room);
      if (state.filters.status !== 'all') params.set('status', state.filters.status);
      const since = sinceFromRange(state.filters.range);
      if (since) params.set('since', String(since));
      return params;
    }

    function renderDashboard(summary) {
      const t = summary.totals;
      refs.dashboardTotals.innerHTML = [
        ['Total', t.total],
        ['Pending', t.pending],
        ['Running', t.running],
        ['Completed', t.completed],
        ['Failed', t.failed],
      ].map(([k, v]) => '<div class="agent-card"><div class="muted">' + k + '</div><div style="font-size:1.4rem;font-weight:700">' + v + '</div></div>').join('');

      if (!summary.agents.length) {
        refs.dashboardAgents.innerHTML = '<div class="empty">No agent status data in this filter window.</div>';
        return;
      }

      refs.dashboardAgents.innerHTML = summary.agents.map((agent) => {
        const name = agent.agentName || agent.agentId;
        return '<div class="agent-card">'
          + '<div style="display:flex;justify-content:space-between;gap:8px"><strong>' + name + '</strong>' + statusPill(String(agent.counts.total) + ' total') + '</div>'
          + '<div class="muted" style="font-size:0.8rem">' + agent.agentId + '</div>'
          + '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:8px">'
          + '<div>Pending: <strong>' + agent.counts.pending + '</strong></div>'
          + '<div>Running: <strong>' + agent.counts.running + '</strong></div>'
          + '<div>Completed: <strong>' + agent.counts.completed + '</strong></div>'
          + '<div>Failed: <strong>' + agent.counts.failed + '</strong></div>'
          + '</div>'
          + '<div class="muted" style="margin-top:6px;font-size:0.8rem">Last mention: ' + fmtTime(agent.lastMentionAt) + '</div>'
          + '</div>';
      }).join('');
    }

    function renderMentionsList(data) {
      state.mentions = data.mentions || [];
      if (!state.mentions.length) {
        refs.mentionsList.innerHTML = '<div class="empty">No mentions match the current filters.</div>';
        refs.mentionDetail.innerHTML = '<div class="empty">No mention selected.</div>';
        return;
      }

      if (!state.activeMentionId || !state.mentions.some((m) => m.id === state.activeMentionId)) {
        state.activeMentionId = state.mentions[0].id;
      }

      refs.mentionsList.innerHTML = state.mentions.map((mention) => {
        const activeClass = mention.id === state.activeMentionId ? 'active' : '';
        return '<button class="row ' + activeClass + '" data-mention-id="' + mention.id + '">'
          + '<div style="display:flex;justify-content:space-between;gap:8px">'
          + '<strong>' + (mention.roomName || mention.roomId) + '</strong>'
          + statusPill(mention.status)
          + '</div>'
          + '<div class="muted" style="font-size:0.8rem">' + mention.id + '</div>'
          + '<div style="margin-top:6px;font-size:0.85rem">From: ' + (mention.fromAgentId || '-') + '</div>'
          + '<div class="muted" style="font-size:0.8rem">Created: ' + fmtTime(mention.createdAt) + '</div>'
          + '</button>';
      }).join('');

      refs.mentionsList.querySelectorAll('[data-mention-id]').forEach((node) => {
        node.addEventListener('click', () => {
          state.activeMentionId = node.getAttribute('data-mention-id');
          renderMentionsList(data);
          loadMentionDetail();
        });
      });
    }

    async function loadMentionDetail() {
      const mention = state.mentions.find((item) => item.id === state.activeMentionId);
      if (!mention) {
        refs.mentionDetail.innerHTML = '<div class="empty">No mention selected.</div>';
        return;
      }

      try {
        const output = await requestJson('/mentions/' + mention.id + '/output');
        const info = output.data || {};
        refs.mentionDetail.innerHTML = ''
          + '<div><strong>' + mention.id + '</strong> ' + statusPill(mention.status) + '</div>'
          + '<div class="muted" style="margin-top:6px">Room: ' + (mention.roomName || mention.roomId) + '</div>'
          + '<div class="muted">Created: ' + fmtTime(mention.createdAt) + '</div>'
          + '<div class="muted">Completed: ' + fmtTime(mention.completedAt || info.completedAt) + '</div>'
          + '<div style="margin-top:8px"><strong>Output</strong></div>'
          + '<div class="mono">' + (info.output || '(no output captured)') + '</div>'
          + '<div style="margin-top:8px"><strong>Error</strong></div>'
          + '<div class="mono">' + (info.error || '(none)') + '</div>';
      } catch (error) {
        refs.mentionDetail.innerHTML = '<div class="error">Failed to load mention detail: ' + error.message + '</div>';
      }
    }

    function renderTimeline(eventsBody, postsBody) {
      const since = sinceFromRange(state.filters.range) || 0;
      const roomId = state.filters.room;
      const events = (eventsBody.data?.events || []).map((event) => ({
        kind: 'event',
        id: event.id,
        at: event.timestamp,
        title: event.type,
        detail: event.source,
      }));

      const posts = (postsBody.data || [])
        .filter((post) => post.createdAt >= since)
        .filter((post) => roomId === 'all' || post.roomId === roomId)
        .map((post) => ({
          kind: 'post',
          id: post.id,
          at: post.createdAt,
          title: 'post in ' + post.roomId,
          detail: (post.content || '').slice(0, 180),
        }));

      const entries = events.concat(posts).sort((a, b) => b.at - a.at).slice(0, 120);
      if (!entries.length) {
        refs.timelineList.innerHTML = '<div class="empty">No timeline activity in this filter window.</div>';
        return;
      }

      refs.timelineList.innerHTML = entries.map((item) => (
        '<div class="timeline-item ' + item.kind + '">'
        + '<div style="display:flex;justify-content:space-between;gap:8px">'
        + '<strong>' + item.title + '</strong><span class="muted">' + fmtTime(item.at) + '</span>'
        + '</div>'
        + '<div class="muted" style="font-size:0.82rem">' + item.id + '</div>'
        + '<div style="margin-top:4px">' + (item.detail || '(no details)') + '</div>'
        + '</div>'
      )).join('');
    }

    function renderWebhookLog(body) {
      const items = body.data || [];
      if (!items.length) {
        refs.webhookList.innerHTML = '<div class="empty">No webhook delivery attempts for current filters.</div>';
        return;
      }

      refs.webhookList.innerHTML = items.map((item) => {
        const klass = item.ok ? 'ok' : 'fail';
        const status = item.ok ? 'success' : 'failure';
        return '<div class="log-item ' + klass + '">'
          + '<div style="display:flex;justify-content:space-between;gap:8px">'
          + '<strong>' + item.eventType + '</strong>' + statusPill(status)
          + '</div>'
          + '<div class="muted" style="font-size:0.8rem">' + fmtTime(item.timestamp) + '</div>'
          + '<div style="font-size:0.84rem">Subscription: ' + (item.subscriptionName || item.subscriptionId) + '</div>'
          + '<div style="font-size:0.84rem">Attempt ' + item.attempt + '/' + item.maxAttempts + ' - ' + (item.statusCode || 'no-status') + ' - ' + item.durationMs + 'ms</div>'
          + '<div class="muted" style="font-size:0.8rem">' + (item.error || item.url) + '</div>'
          + '</div>';
      }).join('');
    }

    async function loadObserver() {
      refs.lastRefresh.textContent = 'Refreshing...';

      try {
        await loadMeta();

        const q = queryParams();
        const summaryUrl = '/mentions/status/summary?' + q.toString();
        const since = sinceFromRange(state.filters.range);
        const eventsUrl = '/events?' + new URLSearchParams({
          limit: '200',
          ...(since ? { since: String(since) } : {}),
        });
        const postsUrl = state.filters.room === 'all' ? '/posts' : ('/posts?roomId=' + encodeURIComponent(state.filters.room));
        const webhookUrl = '/webhook-deliveries?' + new URLSearchParams({
          limit: '200',
          ...(since ? { since: String(since) } : {}),
        });

        const [summary, events, posts, webhookLogs] = await Promise.all([
          requestJson(summaryUrl),
          requestJson(eventsUrl),
          requestJson(postsUrl),
          requestJson(webhookUrl),
        ]);

        renderDashboard(summary.data);
        renderTimeline(events, posts);
        renderWebhookLog(webhookLogs);

        const selected = state.filters.agent !== 'all'
          ? state.filters.agent
          : (summary.data.agents.find((agent) => agent.counts.total > 0)?.agentId || summary.data.agents[0]?.agentId || null);

        if (!selected) {
          refs.mentionsList.innerHTML = '<div class="empty">No agents registered yet.</div>';
          refs.mentionDetail.innerHTML = '<div class="empty">No mention selected.</div>';
        } else {
          state.selectedAgentForList = selected;
          const detailUrl = '/mentions/status/' + encodeURIComponent(selected) + '?' + new URLSearchParams({
            limit: '200',
            ...(state.filters.status !== 'all' ? { status: state.filters.status } : {}),
            ...(state.filters.room !== 'all' ? { roomId: state.filters.room } : {}),
            ...(since ? { since: String(since) } : {}),
          });

          const detail = await requestJson(detailUrl);
          renderMentionsList(detail.data);
          await loadMentionDetail();
        }

        refs.lastRefresh.textContent = 'Last refresh: ' + new Date().toLocaleTimeString();
      } catch (error) {
        const msg = '<div class="error">' + error.message + '</div>';
        refs.dashboardTotals.innerHTML = msg;
        refs.dashboardAgents.innerHTML = '';
        refs.mentionsList.innerHTML = msg;
        refs.mentionDetail.innerHTML = msg;
        refs.timelineList.innerHTML = msg;
        refs.webhookList.innerHTML = msg;
        refs.lastRefresh.textContent = 'Refresh failed';
      }
    }

    function bindFilterEvents() {
      refs.agentFilter.addEventListener('change', () => {
        state.filters.agent = refs.agentFilter.value;
        loadObserver();
      });
      refs.roomFilter.addEventListener('change', () => {
        state.filters.room = refs.roomFilter.value;
        loadObserver();
      });
      refs.statusFilter.addEventListener('change', () => {
        state.filters.status = refs.statusFilter.value;
        loadObserver();
      });
      refs.rangeFilter.addEventListener('change', () => {
        state.filters.range = refs.rangeFilter.value;
        loadObserver();
      });
    }

    bindFilterEvents();
    loadObserver();
    setInterval(loadObserver, 15000);
  </script>
</body>
</html>`;

observerRouter.get('/', (c) => {
  return c.html(observerHtml);
});

export default observerRouter;
