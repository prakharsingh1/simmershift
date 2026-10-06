'use strict';

const storageKey = 'simmershift.sessionId';
const defaultPantry = ['rice', 'couscous', 'chickpeas', 'carrot', 'lemon', 'oil'];
const workspace = document.querySelector('#workspace');
const ui = { session: null, explanation: null, busy: false, clockAnchor: Date.now(), editing: false, resumePrompt: false, pendingInterruptionMinutes: null, noticeTimer: null };
const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const time = (value) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const readableMessage = (value) => String(value ?? '').replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g, (timestamp) => {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return timestamp;
  const reference = new Date(ui.session?.clock || Date.now());
  return date.toDateString() === reference.toDateString() ? time(timestamp) : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
});
const messageMarkup = (value) => escape(readableMessage(value));
const list = (value) => value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
const id = () => globalThis.crypto?.randomUUID?.() || `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const localDateTime = (date) => {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};
const readSavedSession = () => { try { return localStorage.getItem(storageKey); } catch { return null; } };
const saveSession = (sessionId) => { try { localStorage.setItem(storageKey, sessionId); } catch { /* Persistence still lives on the server. */ } };
const clearSavedSession = () => { try { localStorage.removeItem(storageKey); } catch { /* The in-memory view still opens a new dinner. */ } };

async function tool(name, args) {
  const response = await fetch(`/api/tools/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ arguments: args }) });
  let payload;
  try { payload = await response.json(); } catch { throw new Error('The local server returned an unreadable response.'); }
  if (!response.ok || payload.error) {
    const error = new Error(payload.error?.message || `The request could not finish (${response.status}).`);
    error.code = payload.error?.code;
    error.details = payload.error?.details || [];
    throw error;
  }
  return payload.result;
}

function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(ui.noticeTimer);
  ui.noticeTimer = setTimeout(() => { toast.hidden = true; }, 4500);
}

function showError(error) {
  const element = $('#error');
  element.innerHTML = `<strong>${messageMarkup(error.message)}</strong>${(error.details || []).map((detail) => `<span>${messageMarkup(detail)}</span>`).join('<br>')}`;
  element.hidden = false;
}

function acceptSession(session) {
  if (!session?.id || !Array.isArray(session.steps)) throw new Error('The local server did not return a kitchen session.');
  ui.session = session;
  ui.clockAnchor = Date.now();
  saveSession(session.id);
}

async function explain() {
  try { ui.explanation = await tool('explain_changes', { sessionId: ui.session.id }); }
  catch { ui.explanation = null; }
}

async function action(name, args, successMessage) {
  if (ui.busy) return;
  ui.busy = true;
  $('#error').hidden = true;
  workspace.setAttribute('aria-busy', 'true');
  workspace.classList.add('busy-indicator');
  try {
    const mutation = name === 'create_plan' ? { ...args, requestId: id() } : { sessionId: ui.session.id, requestId: id(), expectedRevision: ui.session.revision, ...args };
    acceptSession(await tool(name, mutation));
    await explain();
    ui.editing = false;
    if (name === 'create_plan' || (name === 'pause_resume' && args.action === 'resume')) {
      ui.resumePrompt = false;
      ui.pendingInterruptionMinutes = null;
    }
    render();
    if (successMessage) notify(successMessage);
    return true;
  } catch (error) {
    showError(error);
    if (error.code === 'REVISION_CONFLICT' || error.code === 'CONFLICT') {
      try { acceptSession(await tool('get_session', { sessionId: ui.session.id })); await explain(); render(); } catch { /* Keep the last known state visible. */ }
    }
    return false;
  } finally {
    ui.busy = false;
    workspace.setAttribute('aria-busy', 'false');
    workspace.classList.remove('busy-indicator');
  }
}

function setupMarkup() {
  const serveAt = localDateTime(new Date(Date.now() + 45 * 60000));
  return `<div class="intro-grid"><section class="card setup-card" aria-labelledby="setup-title"><span class="section-eyebrow">YOUR KITCHEN, YOUR CONSTRAINTS</span><h2 class="card-title" id="setup-title">Let's make dinner work.</h2><p class="card-description">A warm grain bowl, a practical plan, and enough room for life to happen. Tell us what you have.</p><form id="create-form"><div class="form-grid"><label class="field full">What's in your pantry?<input name="pantry" value="${defaultPantry.join(', ')}" required><small>Separate ingredients with commas. Try rice or couscous; chickpeas, lentils or tofu; carrot, zucchini or broccoli; lemon or tomato.</small></label><label class="field full">Ingredients to avoid<input name="avoid" placeholder="e.g. tofu, lemon"><small>Ingredient exclusions are exact names, not an allergy safety check.</small></label><label class="field">Servings<input name="servings" type="number" min="1" max="6" value="2" required></label><label class="field">Dinner time<input name="targetServeAt" type="datetime-local" value="${serveAt}" required></label><label class="field">Stovetop<select name="burners"><option value="2">Two burners</option><option value="1">One burner</option></select></label><label class="field">Oven<select name="oven"><option value="false">No oven</option><option value="true">Oven available</option></select></label></div><div class="form-actions"><button class="btn btn-primary" type="submit">Make my dinner plan <span aria-hidden="true">↗</span></button><button class="text-link" type="button" data-action="quick-start">Use the demo pantry</button></div><p class="field-note">Times use your browser's timezone. Plans and progress are saved in the local server's database.</p></form></section><aside class="card demo-card"><span class="section-eyebrow">THE DINNER THAT CAN PIVOT</span><h2>Life doesn't follow<br>a recipe.</h2><p>Take a call. Discover an empty rice jar. Lose a burner. SimmerShift keeps the steps, timers and tradeoffs together.</p><ol class="demo-list"><li><span class="demo-number">1</span>Start a simple bowl</li><li><span class="demo-number">2</span>Throw a curveball</li><li><span class="demo-number">3</span>See what changed, and why</li></ol><button class="btn btn-primary btn-wide" data-action="quick-start">Try the interruption demo <span aria-hidden="true">↗</span></button><p class="demo-footnote">Deterministic planning. Simulated time shifts. No model bill, microphone or connected Alexa device.</p></aside></div>`;
}

function readyState(step) {
  const session = ui.session;
  if (session.status !== 'cooking') return { ready: false, reason: session.status === 'paused' ? 'Resume the kitchen first' : 'Dinner is served' };
  const unfinished = step.dependencies.filter((dep) => session.steps.find((candidate) => candidate.id === dep)?.status !== 'complete');
  if (unfinished.length) return { ready: false, reason: 'Finish earlier steps first' };
  const active = session.steps.filter((candidate) => candidate.status === 'active');
  if (step.resources.includes('hands') && active.some((candidate) => candidate.resources.includes('hands'))) return { ready: false, reason: 'Hands are busy' };
  if (step.resources.includes('burner') && active.filter((candidate) => candidate.resources.includes('burner')).length >= session.constraints.equipment.burners) return { ready: false, reason: 'Waiting for a burner' };
  if (step.resources.includes('oven') && (!session.constraints.equipment.oven || active.some((candidate) => candidate.resources.includes('oven')))) return { ready: false, reason: 'Oven is unavailable' };
  return { ready: true, reason: '' };
}

function allocateBurnerLanes(session) {
  const lanes = Array.from({ length: session.constraints.equipment.burners }, () => []);
  const scheduled = session.steps.filter((step) => step.resources.includes('burner')).sort((a, b) =>
    Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart) ||
    Number(b.status === 'active') - Number(a.status === 'active') || a.id.localeCompare(b.id));
  for (const step of scheduled) {
    const start = Date.parse(step.scheduledStart);
    const end = Date.parse(step.scheduledEnd);
    const available = lanes.find((lane) => lane.every((other) => end <= Date.parse(other.scheduledStart) || start >= Date.parse(other.scheduledEnd)));
    if (available) available.push(step);
    else lanes.push([step]); // Preserve unexpected overlaps visibly, rather than hiding a task.
  }
  return lanes.map((steps, index) => [index < session.constraints.equipment.burners ? `Burner ${index + 1}` : 'Overlap', steps]);
}

function timelineMarkup(session) {
  const starts = session.steps.map((step) => new Date(step.scheduledStart).getTime()).filter(Number.isFinite);
  const ends = session.steps.map((step) => new Date(step.scheduledEnd).getTime()).filter(Number.isFinite);
  const start = Math.min(...starts, new Date(session.clock).getTime());
  const end = Math.max(...ends, new Date(session.estimatedServeAt).getTime(), start + 60000);
  const width = end - start;
  const position = (value) => Math.max(0, Math.min(100, (new Date(value).getTime() - start) / width * 100));
  const ticks = Array.from({ length: 5 }, (_, index) => `<span class="time-tick" style="left:${index * 25}%">${escape(time(start + width * index / 4))}</span>`).join('');
  const resources = [['Hands', session.steps.filter((step) => step.resources.includes('hands'))], ...allocateBurnerLanes(session), ['Oven', session.steps.filter((step) => step.resources.includes('oven'))]];
  const lanes = resources.map(([label, steps]) => `<div class="timeline-lane"><span class="lane-label">${label}</span><div class="lane-track"><span class="timeline-now" style="left:${position(session.clock)}%"></span>${steps.map((step) => {
    const left = position(step.scheduledStart);
    const barWidth = Math.max(.6, position(step.scheduledEnd) - left);
    return `<button class="timeline-bar ${step.status}" style="left:${left}%;width:${barWidth}%" data-action="focus-step" data-step="${escape(step.id)}" title="${escape(`${step.title}: ${time(step.scheduledStart)}–${time(step.scheduledEnd)}`)}" aria-label="${escape(`${step.title}, ${label}, ${time(step.scheduledStart)} to ${time(step.scheduledEnd)}, ${step.status}. Jump to step.`)}">${escape(step.title)}</button>`;
  }).join('')}</div></div>`).join('');
  return `<section class="card timeline-card" aria-labelledby="timeline-title"><div class="card-heading"><h2 id="timeline-title">The kitchen timeline</h2><span class="subtitle">${session.constraints.equipment.burners} burner${session.constraints.equipment.burners === 1 ? '' : 's'} · ${session.constraints.servings} servings</span></div><div class="timeline-legend" aria-label="Timeline legend"><span class="legend-item"><span class="legend-dot"></span>Planned</span><span class="legend-item"><span class="legend-dot active"></span>In progress</span><span class="legend-item"><span class="legend-dot complete"></span>Done</span><span class="legend-item"><span class="legend-dot" style="background:#d39159"></span>Plan clock</span></div><div class="timeline-scroll"><div class="timeline"><div class="time-axis">${ticks}</div>${lanes}</div></div><p class="timeline-caption">Steps can overlap when their dependencies and kitchen resources allow it. Click a block to jump to its step.</p></section>`;
}

function timersMarkup(session) {
  const active = session.steps.filter((step) => step.status === 'active' && step.timerEndsAt);
  if (!active.length) return '';
  return `<section aria-label="Active simulated timers"><div class="active-timers">${active.map((step) => `<div class="timer-card"><div class="timer-ring" id="ring-${escape(step.id)}" style="--progress:0%"><span aria-hidden="true">◷</span></div><div><div class="timer-time" data-timer="${escape(step.id)}">--:--</div><p class="timer-title">${escape(step.title)}</p><p class="timer-label">${session.status === 'paused' ? 'Running · workflow paused' : 'Simulated countdown'}</p></div></div>`).join('')}</div><p class="work-note">Countdowns are a display estimate and keep running during a workflow pause. Confirm each step yourself; a timer never marks food as done.</p></section>`;
}

function hasActiveHeat(session) {
  return session.steps.some((step) => step.status === 'active' && step.resources.some((resource) => resource === 'burner' || resource === 'oven'));
}

function resumePromptMarkup(session) {
  if (!ui.resumePrompt || session.status !== 'paused' || !hasActiveHeat(session)) return '';
  const simulated = ui.pendingInterruptionMinutes !== null;
  return `<section class="resume-check" aria-labelledby="resume-check-title"><span class="section-eyebrow">A QUICK KITCHEN CHECK</span><h2 id="resume-check-title">Before you resume</h2><p>Check your pans and heat before continuing. Did anything change while the workflow was paused? SimmerShift cannot observe your kitchen.</p>${simulated ? `<p class="resume-simulation-note">For this ${ui.pendingInterruptionMinutes}-minute simulation, choose the heat state. The demo clock advances after your choice.</p>` : ''}<div class="resume-check-actions"><button class="btn btn-primary btn-small" data-action="resume-heat-unchanged">Checked: heat unchanged</button><button class="btn btn-plain btn-small" data-action="resume-heat-changed">Heat changed — reset estimates</button></div><p class="work-note">Unchanged heat keeps the saved timer deadlines. Changed heat starts fresh full-duration estimates; inspect the food yourself before confirming completion.</p><button class="text-link resume-stay-paused" data-action="dismiss-resume">Keep workflow paused</button></section>`;
}

function briefingMarkup(session) {
  const saved = ui.explanation?.briefing;
  const completedCount = saved?.completed?.length ?? session.steps.filter((step) => step.status === 'complete').length;
  const active = saved?.active || session.steps.filter((step) => step.status === 'active');
  const nextReady = saved?.nextReady || session.steps.filter((step) => step.status === 'pending' && readyState(step).ready);
  if ((!completedCount && !active.length) || session.status === 'served') return '';
  const focusButton = (step, activeFood) => `<button class="briefing-step ${activeFood ? 'briefing-active' : ''}" data-action="focus-step" data-step="${escape(step.id)}"><span>${escape(step.title)}</span>${activeFood ? `<span class="briefing-timer" data-briefing-timer="${escape(step.id)}">Timer running</span>` : '<span class="briefing-arrow" aria-hidden="true">↗</span>'}</button>`;
  return `<section class="card briefing-card" aria-labelledby="briefing-title"><div class="briefing-heading"><h2 id="briefing-title">Resume briefing</h2><span class="briefing-completed">✓ ${completedCount} step${completedCount === 1 ? '' : 's'} saved as complete</span></div>${saved?.summary ? `<p class="briefing-summary">${messageMarkup(saved.summary)}</p>` : ''}${active.length ? `<div class="briefing-group"><h3>Check these first</h3><div class="briefing-actions">${active.map((step) => focusButton(step, true)).join('')}</div></div>` : ''}${nextReady.length ? `<div class="briefing-group"><h3>Ready next${session.status === 'paused' ? ' · after resuming' : ''}</h3><div class="briefing-actions">${nextReady.map((step) => focusButton(step, false)).join('')}</div></div>` : '<p class="briefing-footnote">Your next step will appear once its prerequisites and resources are available.</p>'}</section>`;
}

function journalMarkup() {
  const history = ui.explanation?.history;
  if (!Array.isArray(history) || !history.length) return '';
  const labels = { create_plan: 'Plan created', change_constraint: 'Kitchen changed', start_step: 'Step started', complete_step: 'Step confirmed', pause_resume: 'Workflow paused / resumed', replan: 'Plan recalculated' };
  return `<details class="recovery-journal"><summary>Recovery journal <span>${history.length} saved revision${history.length === 1 ? '' : 's'}</span></summary><p class="journal-note">Saved with this session · latest first</p><ol class="journal-entries">${history.slice(-10).reverse().map((entry) => {
    const messages = [...new Set((entry.changes || []).map((change) => typeof change === 'string' ? change : change.message))].filter(Boolean);
    return `<li><div class="journal-header"><strong>${escape(labels[entry.operation] || 'Plan updated')}</strong><span>Revision ${escape(entry.revision)} · ${escape(time(entry.at))}</span></div>${messages.length ? `<ul>${messages.map((message) => `<li>${messageMarkup(message)}</li>`).join('')}</ul>` : '<p>Progress saved.</p>'}</li>`;
  }).join('')}</ol></details>`;
}

function stepsMarkup(session) {
  const completed = session.steps.filter((step) => step.status === 'complete').length;
  return `<section class="card steps-card" aria-labelledby="steps-title"><div class="steps-top"><h2 id="steps-title">One step at a time</h2><span class="progress-label">${completed} of ${session.steps.length} done</span></div>${session.steps.map((step, index) => {
    const ready = readyState(step);
    const resourceLabels = step.resources.map((resource) => ({ hands: 'Hands', burner: 'Stovetop', oven: 'Oven' }[resource] || resource));
    const actionButton = step.status === 'complete' ? '<span class="step-done">✓ Done</span>' : step.status === 'active' ? `<button class="btn btn-primary btn-small" data-action="complete-step" data-step="${escape(step.id)}" ${session.status !== 'cooking' ? 'disabled' : ''}>Confirm done</button><span class="step-hint">Check the food before confirming</span>` : `<button class="btn btn-secondary btn-small" data-action="start-step" data-step="${escape(step.id)}" ${!ready.ready ? 'disabled' : ''}>Start step <span aria-hidden="true">↗</span></button>${!ready.ready ? `<span class="step-hint">${escape(ready.reason)}</span>` : ''}`;
    return `<article class="step-row ${step.status}" id="step-${escape(step.id)}" tabindex="-1"><div class="step-number" aria-hidden="true">${step.status === 'complete' ? '✓' : index + 1}</div><div><h3 class="step-title">${escape(step.title)}</h3><p class="step-detail">${messageMarkup(step.detail)}</p><div class="step-tags"><span>${step.durationMinutes} min</span>${resourceLabels.map((resource) => `<span class="step-tag">${escape(resource)}</span>`).join('')}${step.status === 'active' ? '<span>In progress</span>' : ''}</div></div><div class="step-button-area">${actionButton}</div></article>`;
  }).join('')}</section>`;
}

function pantryMarkup(session) {
  const constraints = session.constraints;
  const portionsLocked = session.steps.some((step) => step.status !== 'pending');
  return `<section class="card side-card" aria-labelledby="pantry-title"><h2 id="pantry-title">In your kitchen</h2><div class="pantry-chips">${constraints.pantry.map((ingredient) => `<span class="pantry-chip">${escape(ingredient)}</span>`).join('')}</div><dl class="constraint-summary"><div><dt>Dinner goal</dt><dd>${escape(time(constraints.targetServeAt))}</dd></div><div><dt>Cooking for</dt><dd>${constraints.servings} people</dd></div><div><dt>Stovetop</dt><dd>${constraints.equipment.burners} burner${constraints.equipment.burners === 1 ? '' : 's'}</dd></div><div><dt>Avoiding</dt><dd>${constraints.avoid.length ? escape(constraints.avoid.join(', ')) : 'No ingredients excluded'}</dd></div></dl><button class="text-link side-link" data-action="edit-constraints" aria-expanded="${ui.editing}">${ui.editing ? 'Close kitchen settings' : 'Adjust the pantry & timing'} <span aria-hidden="true">↗</span></button>${ui.editing ? `<form id="constraints-form" class="constraint-editor"><div class="form-grid"><label class="field full">Pantry<input name="pantry" value="${escape(constraints.pantry.join(', '))}" required></label><label class="field full">Avoid ingredients<input name="avoid" value="${escape(constraints.avoid.join(', '))}"></label><label class="field full">Dinner goal<input name="targetServeAt" type="datetime-local" value="${localDateTime(new Date(constraints.targetServeAt))}" required></label><label class="field">Servings<input name="servings" type="number" min="1" max="6" value="${constraints.servings}" ${portionsLocked ? 'readonly aria-describedby="portions-note"' : ''} required>${portionsLocked ? '<small id="portions-note">Locked after a step starts.</small>' : ''}</label><label class="field">Burners<select name="burners"><option value="1" ${constraints.equipment.burners === 1 ? 'selected' : ''}>One</option><option value="2" ${constraints.equipment.burners === 2 ? 'selected' : ''}>Two</option></select></label><label class="field full">Oven<select name="oven"><option value="false" ${!constraints.equipment.oven ? 'selected' : ''}>No oven</option><option value="true" ${constraints.equipment.oven ? 'selected' : ''}>Available</option></select></label></div><button type="submit" class="btn btn-primary btn-small btn-wide" style="margin-top:14px">Update kitchen</button><p class="work-note">Exact ingredient names only. Avoid lists do not certify allergy safety.</p></form>` : ''}</section>`;
}

function changesMarkup(session) {
  const changes = ui.explanation?.changes || session.changes || [];
  const warnings = ui.explanation?.warnings || session.warnings || [];
  const explanationSummary = ui.explanation?.summary;
  const listedSummary = changes.map((change) => typeof change === 'string' ? change : change.message).join(' ');
  const summary = explanationSummary && explanationSummary !== listedSummary ? explanationSummary : null;
  return `<section class="card side-card change-card" aria-labelledby="changes-title"><div class="change-kicker">THE REASON BEHIND THE PLAN</div><h2 id="changes-title">What shifted?</h2>${summary ? `<p class="change-summary">${messageMarkup(summary)}</p>` : ''}<ul class="change-list">${changes.length ? changes.map((change) => `<li><span class="change-mark" aria-hidden="true">↗</span><span>${messageMarkup(typeof change === 'string' ? change : change.message)}</span></li>`).join('') : '<li><span class="change-mark" aria-hidden="true">✓</span><span>Your plan is ready. Interruptions and ingredient swaps will appear here with an explanation.</span></li>'}</ul>${warnings.map((warning) => `<div class="warning">${messageMarkup(warning)}</div>`).join('')}${journalMarkup()}</section>`;
}

function scenarioMarkup(session) {
  const disabled = session.status !== 'cooking' ? 'disabled' : '';
  const ricePending = session.steps.find((step) => step.id === 'prep-base')?.status === 'pending';
  return `<section class="card scenario-card" aria-labelledby="scenario-title"><h2 id="scenario-title">Give the plan a curveball.</h2><p>A few small detours to try. Every action goes through the same server tools as an MCP client.</p><div class="scenario-buttons"><button class="btn btn-plain" data-action="interrupt" ${disabled}><span>Take a 10-minute interruption</span><span class="scenario-icon" aria-hidden="true">◷</span></button><button class="btn btn-plain" data-action="no-rice" ${disabled || (!session.constraints.pantry.includes('rice') || !session.constraints.pantry.includes('couscous') ? 'disabled' : '')}><span>Rice is missing → use couscous</span><span class="scenario-icon" aria-hidden="true">↔</span></button><button class="btn btn-plain" data-action="one-burner" ${disabled || (session.constraints.equipment.burners === 1 ? 'disabled' : '')}><span>Only one burner is available</span><span class="scenario-icon" aria-hidden="true">♧</span></button><button class="btn btn-secondary" data-action="replan" ${disabled}><span>Recalculate the plan</span><span class="scenario-icon" aria-hidden="true">↗</span></button></div><p class="work-note">The interruption explicitly advances the simulation by 10 minutes. The grain swap needs rice and couscous already in your pantry. ${ricePending ? 'Try the grain swap before you begin the grain steps.' : 'Started cooking steps keep their ingredients; swapping may require recovery or a fresh plan.'}</p></section>`;
}

function sessionMarkup(session) {
  const late = Math.max(0, -session.slackMinutes);
  const activeCount = session.steps.filter((step) => step.status === 'active').length;
  const paused = session.status === 'paused';
  return `<div class="session-toolbar"><div><h2 class="session-title">${escape(session.name || 'Tonight’s grain bowl')}</h2><div class="session-meta"><span class="status-pill ${session.status}">${session.status === 'served' ? 'Served' : paused ? 'Workflow paused' : 'Cooking together'}</span><span>Revision ${session.revision}</span><span>${activeCount} active step${activeCount === 1 ? '' : 's'}</span></div></div><div class="toolbar-actions">${session.status !== 'served' ? `<button class="btn btn-plain btn-small" data-action="toggle-pause">${paused ? 'Resume workflow' : 'Pause workflow'}</button>` : ''}<button class="btn btn-plain btn-small" data-action="new-plan">New dinner</button></div></div><div class="session-layout"><div class="main-column"><section class="serve-banner" aria-label="Estimated serving time"><div><div class="banner-eyebrow">${session.status === 'served' ? 'DINNER IS SERVED' : 'DINNER ON THE TABLE'}</div><p class="serve-time">${escape(time(session.estimatedServeAt))}</p><p class="serve-summary">${paused ? 'Workflow paused; active timers keep running. Your progress is saved.' : late ? `Goal ${escape(time(session.constraints.targetServeAt))}. The plan needs ${Math.ceil(late)} more minute${Math.ceil(late) === 1 ? '' : 's'}.` : `Goal ${escape(time(session.constraints.targetServeAt))}. ${Math.floor(session.slackMinutes)} minutes of breathing room.`}</p></div><span class="serve-badge ${late ? 'late' : ''}">${paused ? 'On hold' : late ? `+${Math.ceil(late)} min` : 'On track'}</span></section>${briefingMarkup(session)}${resumePromptMarkup(session)}${paused ? '<div class="paused-note">◷ Workflow paused; active timers keep running. Pausing the plan does not stop heat. Make the kitchen safe yourself before stepping away.</div>' : ''}${session.status === 'served' ? '<section class="served-message"><h2>You made it to dinner.</h2><p>The plan, changes and completed steps are saved. Take a seat. You’ve earned it.</p></section>' : ''}${timersMarkup(session)}${timelineMarkup(session)}${stepsMarkup(session)}</div><aside class="side-column">${pantryMarkup(session)}${changesMarkup(session)}${session.status !== 'served' ? scenarioMarkup(session) : ''}<div class="memory-note">Your kitchen remembers. Reload this page to restore the same persisted session.<details><summary>View local session details</summary><div>Session <code>${escape(session.id)}</code><br>Saved plan clock: ${escape(time(session.clock))}<br>Countdowns use this clock plus elapsed browser time. Workflow pauses preserve active deadlines; countdowns keep running.</div></details></div></aside></div>`;
}

function render() {
  const previous = document.activeElement;
  const focusedAction = previous?.dataset?.action;
  const focusedStep = previous?.dataset?.step;
  workspace.innerHTML = ui.session ? sessionMarkup(ui.session) : setupMarkup();
  workspace.setAttribute('aria-busy', 'false');
  updateTimers();
  if (focusedStep) {
    const row = document.getElementById(`step-${focusedStep}`);
    const nextFocus = row?.querySelector('button:not(:disabled)') || row;
    nextFocus?.focus({ preventScroll: true });
  } else if (focusedAction) {
    workspace.querySelector(`[data-action="${CSS.escape(focusedAction)}"]`)?.focus({ preventScroll: true });
  }
}

function updateTimers() {
  if (!ui.session) return;
  const simulatedNow = new Date(ui.session.clock).getTime() + (ui.session.status !== 'served' ? Date.now() - ui.clockAnchor : 0);
  for (const step of ui.session.steps) {
    const timer = document.querySelector(`[data-timer="${CSS.escape(step.id)}"]`);
    if (!timer || !step.timerEndsAt) continue;
    const remaining = Math.max(0, Math.ceil((new Date(step.timerEndsAt).getTime() - simulatedNow) / 1000));
    timer.textContent = remaining ? `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}` : 'Check food';
    const full = Math.max(1, step.durationMinutes * 60);
    const progress = Math.max(0, Math.min(100, (1 - remaining / full) * 100));
    document.getElementById(`ring-${step.id}`)?.style.setProperty('--progress', `${progress}%`);
    const briefingTimer = document.querySelector(`[data-briefing-timer="${CSS.escape(step.id)}"]`);
    if (briefingTimer) briefingTimer.textContent = remaining ? `~${Math.ceil(remaining / 60)} min · running` : 'Timer elapsed · check now';
  }
}

function constraintsFromForm(form) {
  const data = new FormData(form);
  return { pantry: list(String(data.get('pantry'))), avoid: list(String(data.get('avoid') || '')), servings: Number(data.get('servings')), targetServeAt: new Date(String(data.get('targetServeAt'))).toISOString(), equipment: { burners: Number(data.get('burners')), oven: data.get('oven') === 'true' } };
}

async function quickStart() {
  await action('create_plan', { name: 'Tonight’s flexible grain bowl', constraints: { pantry: defaultPantry, avoid: [], servings: 2, targetServeAt: new Date(Date.now() + 45 * 60000).toISOString(), equipment: { burners: 2, oven: false } } }, 'Your grain bowl plan is ready. Pick a step to begin.');
}

workspace.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!(event.target instanceof HTMLFormElement)) return;
  try {
    const constraints = constraintsFromForm(event.target);
    if (event.target.id === 'create-form') await action('create_plan', { name: 'Tonight’s flexible grain bowl', constraints }, 'Your dinner plan is saved.');
    if (event.target.id === 'constraints-form') await action('change_constraint', { patch: constraints }, 'Kitchen updated. Check what shifted.');
  } catch (error) { showError(error); }
});

workspace.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled || ui.busy) return;
  const name = button.dataset.action;
  if (name === 'quick-start') return quickStart();
  if (name === 'new-plan') {
    clearSavedSession();
    ui.session = null;
    ui.explanation = null;
    ui.editing = false;
    ui.resumePrompt = false;
    ui.pendingInterruptionMinutes = null;
    $('#error').hidden = true;
    render();
    $('#setup-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (!ui.session) return;
  if (name === 'focus-step') {
    const step = document.getElementById(`step-${button.dataset.step}`);
    step?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    step?.focus({ preventScroll: true });
  }
  if (name === 'edit-constraints') { ui.editing = !ui.editing; render(); }
  if (name === 'start-step') await action('start_step', { stepId: button.dataset.step }, 'Step started. Your progress is saved.');
  if (name === 'complete-step') await action('complete_step', { stepId: button.dataset.step }, 'Step confirmed. The next steps are ready.');
  if (name === 'toggle-pause') {
    if (ui.session.status === 'paused' && hasActiveHeat(ui.session)) {
      ui.resumePrompt = true;
      render();
      document.querySelector('[data-action="resume-heat-unchanged"]')?.focus({ preventScroll: true });
      document.querySelector('.resume-check')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      const resuming = ui.session.status === 'paused';
      await action('pause_resume', { action: resuming ? 'resume' : 'pause', ...(resuming && ui.pendingInterruptionMinutes !== null ? { interruptionMinutes: ui.pendingInterruptionMinutes } : {}) }, resuming ? 'Workflow resumed.' : 'Workflow paused; active timers keep running.');
    }
  }
  if (name === 'dismiss-resume') { ui.resumePrompt = false; render(); }
  if ((name === 'resume-heat-unchanged' || name === 'resume-heat-changed') && ui.session.status === 'paused') {
    await action('pause_resume', { action: 'resume', physicalState: name === 'resume-heat-unchanged' ? 'heat_unchanged' : 'heat_changed', ...(ui.pendingInterruptionMinutes !== null ? { interruptionMinutes: ui.pendingInterruptionMinutes } : {}) }, name === 'resume-heat-changed' ? 'Workflow resumed with fresh cooking estimates. Check the food before confirming.' : 'Workflow resumed with the original timer deadlines.');
  }
  if (name === 'interrupt') {
    if (await action('pause_resume', { action: 'pause' })) {
      if (hasActiveHeat(ui.session)) {
        ui.resumePrompt = true;
        ui.pendingInterruptionMinutes = 10;
        render();
        document.querySelector('[data-action="resume-heat-unchanged"]')?.focus({ preventScroll: true });
        document.querySelector('.resume-check')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else await action('pause_resume', { action: 'resume', interruptionMinutes: 10 }, 'Simulation advanced by 10 minutes. Your plan has recovered.');
    }
  }
  if (name === 'no-rice' && ui.session.constraints.pantry.includes('couscous')) await action('change_constraint', { patch: { pantry: ui.session.constraints.pantry.filter((ingredient) => ingredient !== 'rice') } }, 'Pantry changed. See how the grain and timing shifted.');
  if (name === 'one-burner') await action('change_constraint', { patch: { equipment: { burners: 1, oven: ui.session.constraints.equipment.oven } } }, 'One burner available. The kitchen timeline has adjusted.');
  if (name === 'replan') await action('replan', {}, 'Plan recalculated from your saved progress.');
});

async function initialize() {
  const saved = readSavedSession();
  if (saved) {
    try { acceptSession(await tool('get_session', { sessionId: saved })); await explain(); }
    catch (error) {
      const notice = $('#notice');
      notice.textContent = `The previous session could not be restored: ${readableMessage(error.message)} You can start a new dinner below.`;
      notice.hidden = false;
    }
  }
  render();
  setInterval(updateTimers, 1000);
}

initialize();
