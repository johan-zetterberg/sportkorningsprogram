import { syncService } from '../services/syncService.js';

export class SyncQueue extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.unsubscribe = syncService.subscribe(this.update.bind(this));

    // Listen to network status changes to force re-check
    this.onNetworkChange = () => {
      this.update(syncService.getAll());
    };
    window.addEventListener('online', this.onNetworkChange);
    window.addEventListener('offline', this.onNetworkChange);

    this.update(syncService.getAll());
  }

  disconnectedCallback() {
    if (this.unsubscribe) this.unsubscribe();
    window.removeEventListener('online', this.onNetworkChange);
    window.removeEventListener('offline', this.onNetworkChange);
  }

  update(items) {
    const btn = this.shadowRoot.getElementById('sync-btn');
    const list = this.shadowRoot.getElementById('sync-list');
    const countEl = this.shadowRoot.getElementById('sync-count');

    // Uppdatera räknare och visa/dölj knapp
    if (items.length === 0) {
      if (btn) btn.classList.add('hidden');
      if (list) list.classList.add('hidden');
    } else {
      if (btn) {
        btn.classList.remove('hidden');
        btn.classList.add('pulse'); // Animation vid aktivitet
      }
      if (countEl) countEl.textContent = items.length;
    }

    // Uppdatera listan
    if (list) {
      list.innerHTML = items.map(item => `
        <div class="sync-item">
          <span class="spinner">↻</span>
          <span class="desc">${item.desc}</span>
        </div>
      `).join('');
    }
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 9999;
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        }
        .hidden { display: none !important; }
        
        #sync-wrapper {
          position: relative;
        }

        #sync-btn {
          background-color: #f59e0b; /* Amber-500 */
          color: white;
          padding: 8px 16px;
          border-radius: 9999px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
          font-size: 0.875rem;
          border: none;
          transition: all 0.2s;
        }
        
        #sync-btn:hover {
          background-color: #d97706; /* Amber-600 */
          transform: translateY(-1px);
        }

        #sync-list {
          position: absolute;
          bottom: 110%;
          right: 0;
          background: white;
          border-radius: 8px;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
          width: 250px;
          max-height: 300px;
          overflow-y: auto;
          padding: 8px;
          border: 1px solid #e5e7eb;
        }

        /* Dark Mode support (via host-context or manual class checks if passed down, 
           but explicit styles are safer for ShadowDOM independence) */
        /* Dark Mode support */
        @media (prefers-color-scheme: dark) {
          #sync-list {
            background: #1f2937;
            border-color: #374151;
            color: #f3f4f6;
          }
        }
        
        /* Support for manual class-based dark mode (Tailwind standard) */
        :host-context(.dark) #sync-list {
            background: #1f2937;
            border-color: #374151;
            color: #f3f4f6;
        }
        /* Since we can't easily read 'dark' class from html tag inside shadow DOM without hassle,
           we'll rely on default styled properties or slotting. But here hardcoded for simplicity. */

        .sync-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px;
          border-bottom: 1px solid #eee;
          font-size: 0.75rem;
        }
        .sync-item:last-child { border-bottom: none; }

        .spinner {
          display: inline-block;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: .7; }
        }
        .pulse {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
      </style>

      <div id="sync-wrapper">
        <div id="sync-list" class="hidden"></div>
        <button id="sync-btn" class="hidden">
          <span>☁️</span>
          <span id="sync-count">0</span>
          <span>Synkar...</span>
        </button>
      </div>
    `;

    const btn = this.shadowRoot.getElementById('sync-btn');
    const list = this.shadowRoot.getElementById('sync-list');

    btn.addEventListener('click', () => {
      list.classList.toggle('hidden');
    });
  }
}

customElements.define('sync-queue', SyncQueue);
