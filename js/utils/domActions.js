// Delegated handlers for markup built as HTML strings. The Content-Security-
// Policy allows no inline code (onclick="…"), so elements name what to do:
//   data-action="fnName"               a function on window (or a built-in below)
//   data-action-args='["a", 1]'        its arguments (JSON, see actionAttrs)
//   data-action-on="change" | "enter"  on change (select) or Enter (input), with
//                                      the element's value as the argument
//   data-action-value-from="id"        the argument is that input's value
//   data-action-confirm="text"         asks first
//   data-action-stop                   the click goes no further (row handlers)
//   data-hide-on-error                 an <img> hidden when it fails to load

const BUILTIN_ACTIONS = {
    setHash: (hash) => { window.location.hash = hash; },
    clickById: (id) => { document.getElementById(id)?.click(); }
};

function actionArgs(el) {
    const fromId = el.getAttribute('data-action-value-from');
    if (fromId) return [document.getElementById(fromId)?.value ?? ''];
    const raw = el.getAttribute('data-action-args');
    if (!raw) return [];
    try {
        const args = JSON.parse(raw);
        return Array.isArray(args) ? args : [args];
    } catch (_) {
        return [];
    }
}

function runAction(el, args) {
    const name = el.getAttribute('data-action');
    const fn = BUILTIN_ACTIONS[name] || (typeof window[name] === 'function' ? window[name] : null);
    if (!fn) {
        console.warn(`data-action: ${name} finns inte`);
        return;
    }
    const question = el.getAttribute('data-action-confirm');
    if (question && !window.confirm(question)) return;
    fn(...args);
}

function closestAction(event, kind) {
    const target = event.target instanceof Element ? event.target : null;
    const el = target?.closest('[data-action]');
    if (!el) return null;
    return (el.getAttribute('data-action-on') || 'click') === kind ? el : null;
}

export function installDomActions(root = document) {
    if (!root || root.__domActionsInstalled) return;
    root.__domActionsInstalled = true;

    // Capture phase: runs before the row and container listeners, so
    // data-action-stop keeps a button's click from also opening its row
    root.addEventListener('click', (event) => {
        const el = closestAction(event, 'click');
        if (!el) return;
        if (el.hasAttribute('data-action-stop')) event.stopPropagation();
        runAction(el, actionArgs(el));
    }, true);

    root.addEventListener('change', (event) => {
        const el = closestAction(event, 'change');
        if (el) runAction(el, [el.value]);
    });

    root.addEventListener('keyup', (event) => {
        if (event.key !== 'Enter') return;
        const el = closestAction(event, 'enter');
        if (el) runAction(el, [el.value]);
    });

    // Load errors do not bubble: caught on the way down
    root.addEventListener('error', (event) => {
        const el = event.target;
        if (el instanceof HTMLImageElement && el.hasAttribute('data-hide-on-error')) el.style.display = 'none';
    }, true);
}
