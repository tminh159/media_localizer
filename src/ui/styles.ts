export const MEDIA_LOCALIZER_STYLES = `
/* Hide the rudimentary native 1-click "Import All" extract bar inside the Character Editor Gallery tab when Media Localizer is mounted */
.ml-gallery-tab-active > [class*="galleryExtract"] {
  display: none;
}

/* Allow the native galleryTab to scroll smoothly when the Media Localizer panel is expanded */
[class*="galleryTab"].ml-gallery-tab-active {
  overflow-y: auto;
}

/* Prevent the native gallery viewport from being squashed to 0px when Downloaded Media expands */
[class*="galleryTab"].ml-gallery-tab-active > [class*="galleryScrollArea"] {
  min-height: 180px;
}

.ml-gallery-host {
  margin-top: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.92));
  font-family: var(--lumiverse-font-family, inherit);
  font-size: 12px;
  line-height: 1.4;
  width: 100%;
  min-width: 0;
  flex-shrink: 0;
  overflow: visible;
  box-shadow: none;
}

.ml-gallery-host.is-embedded {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.16));
  background: transparent;
  box-shadow: none;
}

.ml-gallery-host.is-embedded .ml-widget,
.ml-widget.is-embedded {
  padding: 0;
}

.ml-drawer-root .ml-gallery-host {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

[data-spindle-drawer-tab]:has(> .ml-drawer-root) {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.ml-drawer-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.92));
  font-family: var(--lumiverse-font-family, inherit);
  font-size: 12px;
  line-height: 1.4;
  overflow: visible;
}

/* Focus & Native Control Accents */
.ml-drawer-root :focus-visible,
.ml-gallery-host :focus-visible,
.ml-lightbox-backdrop :focus-visible,
.ml-portrait-localize-wrap :focus-visible {
  outline: 1.5px solid var(--lumiverse-primary-050, rgba(147, 112, 219, 0.55));
  outline-offset: 1px;
}

.ml-drawer-root input[type="checkbox"],
.ml-gallery-host input[type="checkbox"] {
  accent-color: var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
}

/* Custom Thin Scrollbars */
.ml-drawer-body,
.ml-url-list,
.ml-subfilter-list,
.ml-asset-grid,
.ml-media-list {
  scrollbar-width: thin;
  scrollbar-color: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.22)) transparent;
}

.ml-drawer-body::-webkit-scrollbar,
.ml-url-list::-webkit-scrollbar,
.ml-subfilter-list::-webkit-scrollbar,
.ml-asset-grid::-webkit-scrollbar,
.ml-media-list::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}

.ml-drawer-body::-webkit-scrollbar-track,
.ml-url-list::-webkit-scrollbar-track,
.ml-subfilter-list::-webkit-scrollbar-track,
.ml-asset-grid::-webkit-scrollbar-track,
.ml-media-list::-webkit-scrollbar-track {
  background: transparent;
}

.ml-drawer-body::-webkit-scrollbar-thumb,
.ml-url-list::-webkit-scrollbar-thumb,
.ml-subfilter-list::-webkit-scrollbar-thumb,
.ml-asset-grid::-webkit-scrollbar-thumb,
.ml-media-list::-webkit-scrollbar-thumb {
  background: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.22));
  border-radius: 999px;
}

.ml-drawer-body::-webkit-scrollbar-thumb:hover,
.ml-url-list::-webkit-scrollbar-thumb:hover,
.ml-subfilter-list::-webkit-scrollbar-thumb:hover,
.ml-asset-grid::-webkit-scrollbar-thumb:hover,
.ml-media-list::-webkit-scrollbar-thumb:hover {
  background: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.5));
}

/* Segmented Drawer Navigation */
.ml-drawer-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  min-width: 0;
  padding: 6px 10px;
  border-bottom: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
  background: var(--lumiverse-bg-darker, rgba(0, 0, 0, 0.18));
  flex-shrink: 0;
}

.ml-drawer-nav-btn {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  white-space: nowrap;
  padding: 4px 7px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition:
    color var(--lumiverse-transition-fast, 150ms ease),
    background var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease),
    box-shadow var(--lumiverse-transition-fast, 150ms ease);
}

.ml-drawer-nav-btn:hover {
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.92));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.05));
}

.ml-drawer-nav-btn.is-active {
  color: var(--lumiverse-text, #ffffff);
  font-weight: 600;
  background: var(--lumiverse-primary-015, rgba(147, 112, 219, 0.16));
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.42));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    0 1px 4px rgba(0, 0, 0, 0.2);
}

.ml-drawer-nav-btn.is-active .ml-icon {
  color: var(--lumiverse-primary-text, rgba(186, 135, 255, 0.95));
}

.ml-drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ml-widget {
  --ml-char-card-min: 104px;
  --ml-asset-tile-min: 98px;
  --ml-gallery-tile-min: 96px;
  --ml-asset-thumb-height: 78px;
  --ml-asset-grid-max-height: 260px;
  --ml-list-thumb-size: 34px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  padding: 8px;
}

.ml-widget.is-thumb-sm {
  --ml-char-card-min: 76px;
  --ml-asset-tile-min: 74px;
  --ml-gallery-tile-min: 72px;
  --ml-asset-thumb-height: 58px;
  --ml-asset-grid-max-height: 240px;
  --ml-list-thumb-size: 26px;
}

.ml-widget.is-thumb-md {
  --ml-char-card-min: 104px;
  --ml-asset-tile-min: 98px;
  --ml-gallery-tile-min: 96px;
  --ml-asset-thumb-height: 78px;
  --ml-asset-grid-max-height: 260px;
  --ml-list-thumb-size: 34px;
}

.ml-widget.is-thumb-lg {
  --ml-char-card-min: 148px;
  --ml-asset-tile-min: 142px;
  --ml-gallery-tile-min: 140px;
  --ml-asset-thumb-height: 116px;
  --ml-asset-grid-max-height: 320px;
  --ml-list-thumb-size: 48px;
}

.ml-drawer-root .ml-widget,
.ml-widget.is-drawer {
  padding: 0;
  gap: 8px;
}

.ml-header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px 8px;
  flex-wrap: wrap;
}

.ml-compact-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
}

.ml-inline-stats {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  font-size: 11.5px;
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.9));
}

.ml-subtitle {
  font-size: 11px;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
}

.ml-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

/* Badges & Status Indicators */
.ml-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.1));
  font-size: 10.5px;
  font-weight: 600;
  line-height: 1.35;
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.08));
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.9));
  font-variant-numeric: tabular-nums;
}

.ml-badge.is-success,
.ml-badge.is-local {
  background: var(--lumiverse-success-015, rgba(34, 197, 94, 0.16));
  border-color: var(--lumiverse-success-050, rgba(34, 197, 94, 0.35));
  color: #4ade80;
}

.ml-badge.is-warn,
.ml-badge.is-remote {
  background: var(--lumiverse-warning-015, rgba(245, 158, 11, 0.16));
  border-color: var(--lumiverse-warning-050, rgba(245, 158, 11, 0.35));
  color: #fbbf24;
}

.ml-badge.is-danger,
.ml-badge.is-failed {
  background: var(--lumiverse-danger-015, rgba(239, 68, 68, 0.16));
  border-color: var(--lumiverse-danger-050, rgba(239, 68, 68, 0.38));
  color: #f87171;
}

.ml-badge.is-info {
  background: var(--lumiverse-primary-015, rgba(147, 112, 219, 0.18));
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.38));
  color: var(--lumiverse-primary-text, #c4b5fd);
}

.ml-badge.is-muted {
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.05));
  border-color: var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.1));
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
}

.ml-badge.is-type {
  background: var(--lumiverse-fill-medium, rgba(0, 0, 0, 0.25));
  border-color: var(--lumiverse-border, rgba(147, 112, 219, 0.2));
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.78));
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: 9.5px;
}

.ml-stat-strip {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.ml-stat-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 5px;
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.1));
  background: var(--lumiverse-fill, rgba(0, 0, 0, 0.18));
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.9));
  font-size: 10.5px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.ml-stat-chip.is-success {
  background: var(--lumiverse-success-015, rgba(34, 197, 94, 0.14));
  border-color: rgba(34, 197, 94, 0.28);
  color: #4ade80;
}

.ml-stat-chip.is-warn {
  background: var(--lumiverse-warning-015, rgba(245, 158, 11, 0.14));
  border-color: rgba(245, 158, 11, 0.28);
  color: #fbbf24;
}

.ml-stat-chip.is-danger {
  background: var(--lumiverse-danger-015, rgba(239, 68, 68, 0.14));
  border-color: rgba(239, 68, 68, 0.3);
  color: #fca5a5;
}

.ml-stat-chip.is-info {
  background: var(--lumiverse-primary-015, rgba(147, 112, 219, 0.15));
  border-color: rgba(147, 112, 219, 0.32);
  color: var(--lumiverse-primary-text, #c4b5fd);
}

.ml-stat-chip.is-muted {
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.62));
}

.ml-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  flex-shrink: 0;
  display: inline-block;
  background: var(--lumiverse-text-dim, rgba(255, 255, 255, 0.4));
}

.ml-status-dot.is-success {
  background: var(--lumiverse-success, #22c55e);
  box-shadow: 0 0 6px var(--lumiverse-success-050, rgba(34, 197, 94, 0.5));
}

.ml-status-dot.is-warn {
  background: var(--lumiverse-warning, #f59e0b);
  box-shadow: 0 0 6px var(--lumiverse-warning-050, rgba(245, 158, 11, 0.5));
}

.ml-status-dot.is-danger {
  background: var(--lumiverse-danger, #ef4444);
  box-shadow: 0 0 6px var(--lumiverse-danger-050, rgba(239, 68, 68, 0.5));
}

.ml-status-dot.is-muted {
  background: var(--lumiverse-text-dim, rgba(255, 255, 255, 0.35));
}

/* Button Hierarchy */
.ml-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.18));
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.06));
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.9));
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease),
    color var(--lumiverse-transition-fast, 150ms ease),
    transform 100ms ease,
    box-shadow var(--lumiverse-transition-fast, 150ms ease);
}

.ml-btn:hover:not(:disabled) {
  background: var(--lumiverse-bg-hover, rgba(255, 255, 255, 0.12));
  border-color: var(--lumiverse-border-hover, rgba(147, 112, 219, 0.32));
}

.ml-btn:active:not(:disabled) {
  transform: translateY(0.5px);
}

.ml-btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.ml-btn.is-primary {
  background: var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
  border-color: var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
  color: #ffffff;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    0 1px 4px rgba(0, 0, 0, 0.25);
}

.ml-btn.is-primary:hover:not(:disabled) {
  background: var(--lumiverse-primary-hover, rgba(167, 132, 239, 0.95));
  border-color: var(--lumiverse-primary-hover, rgba(167, 132, 239, 0.95));
}

.ml-btn.is-danger {
  background: var(--lumiverse-danger-015, rgba(239, 68, 68, 0.15));
  border-color: var(--lumiverse-danger-050, rgba(239, 68, 68, 0.4));
  color: #fca5a5;
}

.ml-btn.is-danger:hover:not(:disabled) {
  background: var(--lumiverse-danger-020, rgba(239, 68, 68, 0.26));
  border-color: var(--lumiverse-danger, #ef4444);
  color: #fecaca;
}

.ml-btn.is-active {
  background: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.24));
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.55));
  color: var(--lumiverse-text, #ffffff);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.ml-btn.is-sm {
  padding: 2.5px 6.5px;
  font-size: 11px;
}

.ml-btn.is-xs {
  padding: 1.5px 5px;
  font-size: 10px;
}

.ml-icon-btn {
  padding: 3px 5px;
}

.ml-icon-btn.is-sm {
  padding: 2px 4px;
}

.ml-icon {
  display: block;
  flex-shrink: 0;
}

@keyframes ml-spin {
  to {
    transform: rotate(360deg);
  }
}

.ml-btn.is-busy .ml-icon {
  animation: ml-spin 0.9s linear infinite;
}

/* Segmented Control Wrapper */
.ml-segmented {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 7px;
  background: var(--lumiverse-bg-darker, rgba(0, 0, 0, 0.28));
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
}

.ml-segmented .ml-btn {
  border-color: transparent;
  background: transparent;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
  box-shadow: none;
}

.ml-segmented .ml-btn:hover:not(:disabled) {
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.06));
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.92));
}

.ml-segmented .ml-btn.is-active {
  background: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.24));
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.45));
  color: var(--lumiverse-text, #ffffff);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.ml-thumb-size-segmented {
  flex-shrink: 0;
}

.ml-thumb-size-segmented .ml-btn {
  min-width: 20px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.ml-toggle-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  cursor: pointer;
  user-select: none;
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.9));
}

/* Flat Borderless Flow Sections */
.ml-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.ml-section + .ml-section {
  padding-top: 8px;
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
}

.ml-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
}

.ml-subsection-label {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lumiverse-text-dim, rgba(255, 255, 255, 0.45));
  padding-top: 4px;
  margin-top: 2px;
  border-top: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.08));
}

.ml-batch-char-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px 8px;
  flex-wrap: wrap;
}

.ml-check-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 155px), 1fr));
  gap: 5px;
}

.ml-check-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  padding: 4px 7px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.08));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.03));
  font-size: 11.5px;
  min-width: 0;
  transition: border-color var(--lumiverse-transition-fast, 150ms ease), background var(--lumiverse-transition-fast, 150ms ease);
}

.ml-check-card:hover {
  border-color: var(--lumiverse-border, rgba(147, 112, 219, 0.22));
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.05));
}

.ml-check-card-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ml-check-card-left > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.ml-subfilter-box {
  margin-top: 2px;
  padding-top: 6px;
  border-top: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.08));
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.ml-subfilter-list {
  max-height: 130px;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 145px), 1fr));
  gap: 3px 6px;
}

/* Filter Pills */
.ml-pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.ml-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2.5px 8px;
  border-radius: 999px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.18));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.04));
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.78));
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  transition:
    background var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease),
    color var(--lumiverse-transition-fast, 150ms ease);
}

.ml-pill:hover {
  background: var(--lumiverse-fill-hover, rgba(255, 255, 255, 0.09));
  border-color: var(--lumiverse-border-hover, rgba(147, 112, 219, 0.3));
  color: var(--lumiverse-text, #ffffff);
}

.ml-pill.is-selected {
  background: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.22));
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.55));
  color: var(--lumiverse-text, #ffffff);
  font-weight: 600;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.ml-pill.is-video.is-selected {
  background: rgba(56, 189, 248, 0.18);
  border-color: rgba(56, 189, 248, 0.48);
  color: #bae6fd;
}

.ml-pill.is-expression.is-selected {
  background: rgba(244, 114, 182, 0.18);
  border-color: rgba(244, 114, 182, 0.48);
  color: #fbcfe8;
}

.ml-pill.is-avatar.is-selected {
  background: var(--lumiverse-success-015, rgba(34, 197, 94, 0.18));
  border-color: var(--lumiverse-success-050, rgba(34, 197, 94, 0.48));
  color: #bbf7d0;
}

.ml-pill.is-image.is-selected {
  background: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.22));
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.55));
  color: var(--lumiverse-primary-text, #e9d5ff);
}

/* URL & Batch Lists */
.ml-url-list {
  max-height: clamp(210px, 42vh, 420px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 2px;
}

.ml-url-list.is-tall {
  max-height: clamp(240px, 56vh, 600px);
}

.ml-url-item-card,
.ml-lib-item-card {
  display: flex;
  flex-direction: column;
  border-radius: 6px;
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.08));
  transition:
    border-color var(--lumiverse-transition-fast, 150ms ease),
    background var(--lumiverse-transition-fast, 150ms ease);
}

.ml-url-item-card:hover,
.ml-lib-item-card:hover {
  border-color: var(--lumiverse-border-hover, rgba(147, 112, 219, 0.25));
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.05));
}

.ml-url-item-card.is-expanded,
.ml-lib-item-card.is-expanded {
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.45));
  background: var(--lumiverse-primary-010, rgba(147, 112, 219, 0.07));
}

.ml-lib-item-card.is-selected {
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.42));
  background: var(--lumiverse-primary-010, rgba(147, 112, 219, 0.08));
}

.ml-url-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  font-size: 11.5px;
  cursor: pointer;
  user-select: none;
}

.ml-row-checkbox {
  cursor: pointer;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  margin: 0;
}

.ml-url-thumb {
  width: 28px;
  height: 28px;
  border-radius: 5px;
  object-fit: cover;
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.1));
  background: var(--lumiverse-bg-darker, rgba(0, 0, 0, 0.4));
  flex-shrink: 0;
}

.ml-url-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ml-url-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.92));
  font-family: var(--lumiverse-font-mono, monospace);
  font-size: 11px;
}

.ml-url-sources {
  font-size: 10.5px;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ml-kind-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 9.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  flex-shrink: 0;
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.08));
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.75));
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.1));
}

.ml-kind-chip.is-image {
  background: var(--lumiverse-primary-010, rgba(147, 112, 219, 0.14));
  border-color: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.3));
  color: var(--lumiverse-primary-text, #d8b4fe);
}

.ml-kind-chip.is-video {
  background: rgba(56, 189, 248, 0.14);
  border-color: rgba(56, 189, 248, 0.3);
  color: #7dd3fc;
}

.ml-kind-chip.is-failed {
  background: var(--lumiverse-danger-015, rgba(239, 68, 68, 0.16));
  border-color: var(--lumiverse-danger-050, rgba(239, 68, 68, 0.38));
  color: #fca5a5;
}

.ml-expand-hint {
  font-size: 10.5px;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
  padding: 2px 5px;
  border-radius: 4px;
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.05));
  flex-shrink: 0;
}

.ml-item-details {
  padding: 6px 8px;
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
  background: var(--lumiverse-bg-darker, rgba(0, 0, 0, 0.28));
  border-bottom-left-radius: 6px;
  border-bottom-right-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
}

.ml-detail-top {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.ml-detail-preview-box {
  width: 88px;
  min-height: 58px;
  max-height: 104px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.16));
  background: var(--lumiverse-bg-deep, rgba(10, 8, 18, 0.8));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
  position: relative;
}

.ml-detail-preview-media {
  max-width: 88px;
  max-height: 88px;
  object-fit: contain;
  display: block;
  cursor: pointer;
}

.ml-detail-preview-caption {
  font-size: 10px;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
  padding: 2px 4px;
  text-align: center;
  width: 100%;
  background: rgba(0, 0, 0, 0.55);
}

.ml-detail-info-col {
  flex: 1;
  min-width: min(100%, 140px);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ml-detail-url-box {
  font-family: var(--lumiverse-font-mono, monospace);
  font-size: 10.5px;
  word-break: break-all;
  padding: 4px 6px;
  border-radius: 5px;
  background: var(--lumiverse-bg-deep, rgba(10, 8, 18, 0.65));
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.1));
  color: var(--lumiverse-text, #f8fafc);
  user-select: text;
}

.ml-detail-kv-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.ml-detail-source-list {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.ml-detail-source-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 10px;
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.07));
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.1));
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.88));
}

.ml-detail-error-box {
  padding: 4px 6px;
  border-radius: 5px;
  background: var(--lumiverse-danger-015, rgba(239, 68, 68, 0.14));
  border: 1px solid var(--lumiverse-danger-050, rgba(239, 68, 68, 0.35));
  color: #fca5a5;
  font-size: 10.5px;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.ml-download-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
  padding-top: 5px;
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.12));
}

/* Inputs & Selects */
.ml-select {
  padding: 3.5px 7px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.2));
  background: var(--lumiverse-bg-deep, rgba(10, 8, 18, 0.85));
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.92));
  font-family: inherit;
  font-size: 11.5px;
  cursor: pointer;
  transition: border-color var(--lumiverse-transition-fast, 150ms ease), box-shadow var(--lumiverse-transition-fast, 150ms ease);
}

.ml-select:hover {
  border-color: var(--lumiverse-border-hover, rgba(147, 112, 219, 0.35));
}

.ml-select:focus {
  outline: none;
  border-color: var(--lumiverse-primary-muted, rgba(147, 112, 219, 0.6));
  box-shadow: 0 0 0 2px var(--lumiverse-primary-010, rgba(147, 112, 219, 0.12));
}

.ml-input-num {
  width: 58px;
  padding: 3px 6px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.2));
  background: var(--lumiverse-input-bg, var(--lumiverse-fill, rgba(0, 0, 0, 0.2)));
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.92));
  font-family: inherit;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  transition: border-color var(--lumiverse-transition-fast, 150ms ease), box-shadow var(--lumiverse-transition-fast, 150ms ease);
}

.ml-input-num:focus {
  outline: none;
  border-color: var(--lumiverse-primary-muted, rgba(147, 112, 219, 0.6));
  box-shadow: 0 0 0 2px var(--lumiverse-primary-010, rgba(147, 112, 219, 0.12));
}

.ml-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1 1 120px;
  min-width: 100px;
}

.ml-input-icon {
  position: absolute;
  left: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--lumiverse-text-dim, rgba(255, 255, 255, 0.45));
  pointer-events: none;
}

.ml-input-text {
  flex: 1;
  min-width: min(100%, 100px);
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.2));
  background: var(--lumiverse-input-bg, var(--lumiverse-fill, rgba(0, 0, 0, 0.2)));
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.92));
  font-family: inherit;
  font-size: 11.5px;
  transition: border-color var(--lumiverse-transition-fast, 150ms ease), box-shadow var(--lumiverse-transition-fast, 150ms ease);
}

.ml-input-text.has-icon {
  padding-left: 26px;
}

.ml-input-text::placeholder {
  color: var(--lumiverse-text-dim, rgba(255, 255, 255, 0.4));
}

.ml-input-text:focus {
  outline: none;
  border-color: var(--lumiverse-primary-muted, rgba(147, 112, 219, 0.6));
  box-shadow: 0 0 0 2px var(--lumiverse-primary-010, rgba(147, 112, 219, 0.14));
}

/* Active Queue Banner & Progress */
@keyframes ml-progress-shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

.ml-queue-banner {
  border: 1px solid var(--lumiverse-primary-050, rgba(147, 112, 219, 0.45));
  background: linear-gradient(
    180deg,
    var(--lumiverse-primary-015, rgba(147, 112, 219, 0.16)) 0%,
    var(--lumiverse-primary-010, rgba(147, 112, 219, 0.08)) 100%
  );
  border-radius: var(--lumiverse-radius, 8px);
  padding: 7px 8px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  box-shadow: var(--lumiverse-highlight-inset, inset 0 1px 0 rgba(255, 255, 255, 0.08));
}

.ml-queue-banner.is-paused {
  border-color: var(--lumiverse-warning-050, rgba(245, 158, 11, 0.45));
  background: linear-gradient(
    180deg,
    var(--lumiverse-warning-015, rgba(245, 158, 11, 0.14)) 0%,
    rgba(245, 158, 11, 0.06) 100%
  );
}

.ml-queue-banner.is-cancelling {
  border-color: var(--lumiverse-danger-050, rgba(239, 68, 68, 0.45));
  background: linear-gradient(
    180deg,
    var(--lumiverse-danger-015, rgba(239, 68, 68, 0.14)) 0%,
    rgba(239, 68, 68, 0.06) 100%
  );
}

.ml-queue-status-text {
  font-weight: 600;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  color: var(--lumiverse-text, #ffffff);
}

.ml-progress-track {
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: var(--lumiverse-bg-darker, rgba(0, 0, 0, 0.35));
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.08));
  overflow: hidden;
}

.ml-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
  transition: width 0.25s ease;
}

.ml-progress-fill.is-active {
  background: linear-gradient(
    90deg,
    var(--lumiverse-primary, rgba(147, 112, 219, 0.9)) 0%,
    var(--lumiverse-primary-hover, rgba(186, 135, 255, 0.98)) 50%,
    var(--lumiverse-primary, rgba(147, 112, 219, 0.9)) 100%
  );
  background-size: 200% 100%;
  animation: ml-progress-shimmer 2.2s linear infinite;
}

.ml-queue-banner.is-paused .ml-progress-fill {
  background: var(--lumiverse-warning, #f59e0b);
}

.ml-queue-banner.is-cancelling .ml-progress-fill {
  background: var(--lumiverse-danger, #ef4444);
}

.ml-mini-progress {
  width: 100%;
  height: 3px;
  border-radius: 999px;
  background: var(--lumiverse-bg-darker, rgba(0, 0, 0, 0.32));
  overflow: hidden;
}

.ml-mini-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    var(--lumiverse-success, #22c55e) 0%,
    #4ade80 100%
  );
  transition: width 0.25s ease;
}

/* Asset Grid & Cards */
.ml-asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--ml-asset-tile-min, 98px)), 1fr));
  grid-auto-rows: max-content;
  align-content: start;
  gap: 6px;
  max-height: var(--ml-asset-grid-max-height, 260px);
  overflow-y: auto;
  flex-shrink: 0;
  min-width: 0;
  padding: 1px;
}

.ml-asset-card {
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
  border-radius: 7px;
  background: var(--lumiverse-bg-dark, rgba(0, 0, 0, 0.25));
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: max-content;
  contain: layout paint style;
  transition:
    transform var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease);
}

.ml-asset-card:hover {
  border-color: var(--lumiverse-border-hover, rgba(147, 112, 219, 0.35));
  box-shadow: var(--lumiverse-shadow-sm, 0 2px 8px rgba(0, 0, 0, 0.25));
}

.ml-asset-preview {
  display: block;
  width: 100%;
  height: var(--ml-asset-thumb-height, 78px);
  object-fit: cover;
  background: var(--lumiverse-bg-deep, rgba(0, 0, 0, 0.4));
  cursor: pointer;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.ml-asset-card:hover .ml-asset-preview {
  transform: scale(1.04);
}

.ml-asset-footer {
  padding: 4px 5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex-shrink: 0;
  min-width: 0;
  font-size: 10px;
  border-top: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.06));
}

.ml-lib-intro {
  font-size: 11px;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.68));
  line-height: 1.4;
}

.ml-step-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.22));
  border: 1px solid var(--lumiverse-primary-050, rgba(147, 112, 219, 0.4));
  color: var(--lumiverse-primary-text, #e9d5ff);
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.ml-lib-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  padding: 5px 7px;
  cursor: pointer;
  user-select: none;
}

.ml-lib-char-name {
  font-weight: 600;
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.92));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.ml-lib-row .ml-header-actions {
  flex-shrink: 0;
}

.ml-drawer-sticky-banner {
  padding: 6px 10px 0;
  flex-shrink: 0;
}

.ml-drawer-sticky-banner:empty {
  display: none;
}

.ml-inline-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.ml-title {
  font-weight: 600;
  font-size: 12.5px;
  color: var(--lumiverse-text, #f8fafc);
}

.ml-stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ml-config-label-row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.ml-config-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
}

.ml-checkbox-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: center;
}

.ml-checkbox-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.9));
  cursor: pointer;
  user-select: none;
}

.ml-setting-toggle-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
  gap: 4px 8px;
}

.ml-setting-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  padding: 4px 7px;
  border-radius: 6px;
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.025));
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.07));
  transition: border-color var(--lumiverse-transition-fast, 150ms ease), background var(--lumiverse-transition-fast, 150ms ease);
}

.ml-setting-toggle-row:hover {
  border-color: var(--lumiverse-border, rgba(147, 112, 219, 0.2));
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.04));
}

.ml-setting-toggle-row.is-caution {
  border-color: rgba(239, 68, 68, 0.25);
  background: rgba(239, 68, 68, 0.06);
}

.ml-setting-toggle-row.is-caution:hover {
  border-color: var(--lumiverse-danger-050, rgba(239, 68, 68, 0.42));
}

.ml-select.is-sm {
  padding: 2px 5px;
  font-size: 11px;
}

/* Banners & Empty States */
.ml-error-banner {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--lumiverse-danger-015, rgba(239, 68, 68, 0.14));
  border: 1px solid var(--lumiverse-danger-050, rgba(239, 68, 68, 0.35));
  color: #fca5a5;
  font-size: 11.5px;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.ml-warn-banner {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 6px;
  background: var(--lumiverse-warning-015, rgba(245, 158, 11, 0.12));
  border: 1px solid var(--lumiverse-warning-050, rgba(245, 158, 11, 0.3));
  color: #fcd34d;
  font-size: 11px;
}

.ml-error-banner .ml-icon,
.ml-warn-banner .ml-icon {
  margin-top: 1px;
}

.ml-empty {
  text-align: center;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.62));
  padding: 12px 10px;
  font-size: 11.5px;
}

.ml-empty-card,
.ml-loading-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 20px 12px;
  border: none;
  background: transparent;
}

.ml-empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: var(--lumiverse-primary-010, rgba(147, 112, 219, 0.12));
  color: var(--lumiverse-primary-text, rgba(186, 135, 255, 0.85));
}

.ml-loading-card .ml-empty-icon .ml-icon {
  animation: ml-spin 1.2s linear infinite;
}

.ml-empty-text {
  font-size: 11.5px;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
  max-width: 280px;
  line-height: 1.4;
}

/* Info tooltips (hover + click popover for mobile) */
.ml-tip-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.ml-tip-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.6));
  cursor: pointer;
  opacity: 0.8;
  transition: opacity var(--lumiverse-transition-fast, 150ms ease), color var(--lumiverse-transition-fast, 150ms ease), background var(--lumiverse-transition-fast, 150ms ease);
}

.ml-tip-btn:hover,
.ml-tip-wrap.is-open .ml-tip-btn {
  opacity: 1;
  color: var(--lumiverse-text, #f8fafc);
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.1));
}

.ml-tip-popover {
  display: none;
  position: absolute;
  left: 0;
  top: calc(100% + 6px);
  width: max-content;
  max-width: min(240px, 65vw);
  padding: 6px 8px;
  border-radius: 7px;
  background: var(--lumiverse-bg-elevated, rgba(24, 20, 34, 0.97));
  border: 1px solid var(--lumiverse-border-hover, rgba(147, 112, 219, 0.28));
  color: var(--lumiverse-text, #f1f5f9);
  font-size: 11px;
  font-weight: 400;
  text-transform: none;
  letter-spacing: normal;
  line-height: 1.4;
  white-space: normal;
  box-shadow: var(--lumiverse-shadow-md, 0 8px 24px rgba(0, 0, 0, 0.45));
  backdrop-filter: blur(8px);
  z-index: 40;
  pointer-events: none;
}

.ml-tip-wrap:hover .ml-tip-popover,
.ml-tip-wrap.is-open .ml-tip-popover {
  display: block;
}

.ml-tip-wrap.is-open .ml-tip-popover {
  pointer-events: auto;
}

.ml-setting-toggle-row .ml-tip-popover,
.ml-header-bar > .ml-tip-wrap:last-child .ml-tip-popover,
.ml-combined-bar .ml-tip-popover,
.ml-checkbox-item:last-child .ml-tip-popover,
.ml-tip-wrap.is-align-right .ml-tip-popover {
  left: auto;
  right: 0;
}

/* Active Character Header */
.ml-char-header {
  gap: 6px;
}

.ml-char-identity {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ml-char-avatar {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  object-fit: cover;
  border: 1px solid var(--lumiverse-border-hover, rgba(147, 112, 219, 0.26));
  flex-shrink: 0;
  background: var(--lumiverse-bg-deep, rgba(0, 0, 0, 0.35));
}

.ml-char-avatar-fallback {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.22));
  background: var(--lumiverse-card-image-bg, linear-gradient(135deg, rgba(20, 17, 28, 1) 0%, rgba(36, 26, 54, 1) 100%));
  color: var(--lumiverse-primary-text, rgba(186, 135, 255, 0.9));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 13px;
  flex-shrink: 0;
  user-select: none;
}

.ml-char-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ml-char-name {
  font-weight: 600;
  font-size: 12.5px;
  color: var(--lumiverse-text, #f8fafc);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.ml-status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

/* Combined Character Options & Downloaded Media Bar */
.ml-combined-drawer {
  gap: 6px;
}

.ml-combined-bar {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.ml-combined-trigger {
  flex: 1 1 110px;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.08));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.03));
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.78));
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease),
    color var(--lumiverse-transition-fast, 150ms ease);
}

.ml-combined-trigger:hover {
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.07));
  border-color: var(--lumiverse-border-hover, rgba(147, 112, 219, 0.3));
  color: var(--lumiverse-text, rgba(255, 255, 255, 0.94));
}

.ml-combined-trigger.is-active {
  background: var(--lumiverse-primary-015, rgba(147, 112, 219, 0.16));
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.45));
  color: var(--lumiverse-text, #ffffff);
  font-weight: 600;
}

.ml-combined-trigger > span:not(.ml-badge) {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.ml-combined-pane {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding-top: 2px;
}

.ml-combined-pane + .ml-combined-pane {
  padding-top: 8px;
  margin-top: 2px;
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
}

.ml-options-panel {
  gap: 6px;
}

.ml-media-pane {
  gap: 6px;
}

.ml-media-toolbar {
  gap: 5px;
}

/* Failed Items Recovery Panel */
.ml-failed-panel {
  border-top-color: var(--lumiverse-danger-050, rgba(239, 68, 68, 0.32));
}

.ml-failed-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ml-failed-group-title {
  font-size: 11px;
  font-weight: 600;
  color: #fca5a5;
}

.ml-failed-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  background: var(--lumiverse-bg-darker, rgba(0, 0, 0, 0.28));
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.07));
}

.ml-failed-url-col {
  flex: 1;
  min-width: 0;
}

/* Media Tiles & List View */
.ml-asset-thumb-wrap {
  position: relative;
  width: 100%;
  height: var(--ml-asset-thumb-height, 78px);
  min-height: var(--ml-asset-thumb-height, 78px);
  flex-shrink: 0;
  background: var(--lumiverse-bg-deep, rgba(0, 0, 0, 0.42));
  cursor: pointer;
  overflow: hidden;
  contain: layout paint style;
}

.ml-asset-thumb-wrap .ml-asset-preview {
  height: 100%;
}

.ml-tile-badge {
  position: absolute;
  bottom: 4px;
  left: 4px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 9.5px;
  font-weight: 600;
  background: rgba(12, 10, 20, 0.88);
  color: #f1f5f9;
  border: 1px solid rgba(255, 255, 255, 0.16);
  pointer-events: none;
  z-index: 2;
}

.ml-tile-badge.is-info {
  background: rgba(124, 58, 237, 0.84);
  border-color: rgba(196, 181, 253, 0.35);
  color: #ffffff;
}

.ml-tile-badge.is-video {
  background: rgba(14, 116, 144, 0.86);
  border-color: rgba(125, 211, 252, 0.35);
  color: #e0f2fe;
}

.ml-tile-badge.is-expression {
  background: rgba(157, 23, 77, 0.84);
  border-color: rgba(249, 168, 212, 0.35);
  color: #fce7f3;
}

.ml-tile-badge.is-avatar {
  background: rgba(21, 128, 61, 0.84);
  border-color: rgba(134, 239, 172, 0.35);
  color: #dcfce7;
}

.ml-tile-badge.is-local {
  background: rgba(21, 128, 61, 0.84);
  border-color: rgba(134, 239, 172, 0.35);
  color: #dcfce7;
}

.ml-asset-cap-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.ml-asset-cap-row .ml-url-sources {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ml-media-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 460px;
  overflow-y: auto;
  flex-shrink: 0;
  min-width: 0;
}

.ml-media-list-row {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
  min-width: 0;
  padding: 5px 7px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.08));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.03));
  cursor: pointer;
  contain: layout paint style;
  transition:
    background var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease);
}

.ml-media-list-row:hover {
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.07));
  border-color: var(--lumiverse-border-hover, rgba(147, 112, 219, 0.28));
}

.ml-media-list-thumb-wrap {
  position: relative;
  width: var(--ml-list-thumb-size, 34px);
  height: var(--ml-list-thumb-size, 34px);
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
  border: 1px solid var(--lumiverse-border-neutral, rgba(255, 255, 255, 0.1));
  background: var(--lumiverse-bg-deep, rgba(0, 0, 0, 0.35));
}

.ml-media-list-thumb {
  width: var(--ml-list-thumb-size, 34px);
  height: var(--ml-list-thumb-size, 34px);
  border-radius: 5px;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--lumiverse-bg-deep, rgba(0, 0, 0, 0.35));
  display: block;
}

.ml-media-list-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--lumiverse-card-image-bg, linear-gradient(135deg, rgba(20, 17, 28, 1) 0%, rgba(36, 26, 54, 1) 100%));
  color: var(--lumiverse-primary-text, rgba(186, 135, 255, 0.8));
  font-size: 12px;
  font-weight: 600;
}

.ml-media-list-kind-badge {
  position: absolute;
  bottom: 1px;
  right: 1px;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: rgba(10, 8, 18, 0.82);
  color: #e0f2fe;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

/* Whole-Library Gallery */
.ml-gallery-toolbar {
  padding: 0;
  gap: 5px;
}

.ml-gallery-content-slot {
  padding-left: 0;
  padding-right: 0;
  padding-bottom: 0;
  gap: 6px;
}

.ml-gallery-controls {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.ml-gallery-controls .ml-input-text {
  min-width: 100px;
  flex: 1 1 120px;
}

.ml-sort-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.ml-gallery-type-pills {
  margin-top: 0;
  gap: 4px;
}

.ml-gallery-drilldown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px 6px;
  flex-wrap: wrap;
  padding-bottom: 5px;
  border-bottom: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
}

.ml-gallery-drilldown-title {
  flex: 1 1 110px;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ml-gallery-drilldown-avatar {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  object-fit: cover;
  border: 1px solid var(--lumiverse-border-hover, rgba(147, 112, 219, 0.28));
  flex-shrink: 0;
  background: var(--lumiverse-bg-deep, rgba(0, 0, 0, 0.35));
}

.ml-gallery-drilldown-name {
  font-weight: 600;
  font-size: 12.5px;
  color: var(--lumiverse-text, #f8fafc);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.ml-drawer-root .ml-asset-grid,
.ml-drawer-root .ml-media-list,
.ml-gallery-grid {
  max-height: none;
  overflow-y: visible;
}

.ml-gallery-grid {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--ml-gallery-tile-min, 96px)), 1fr));
  gap: 6px;
}

.ml-gallery-grid .ml-asset-footer {
  padding: 3.5px 5px;
}

.ml-gallery-grid .ml-url-sources {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ml-char-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--ml-char-card-min, 104px)), 1fr));
  gap: 6px;
}

.ml-char-card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.16));
  border-radius: 9px;
  background: var(--lumiverse-card-bg, rgba(24, 20, 34, 0.92));
  color: inherit;
  text-align: left;
  overflow: hidden;
  cursor: pointer;
  contain: layout paint style;
  box-shadow: var(--lumiverse-shadow-sm, 0 2px 8px rgba(0, 0, 0, 0.22));
  transition:
    transform 0.16s cubic-bezier(0.4, 0, 0.2, 1),
    border-color 0.16s cubic-bezier(0.4, 0, 0.2, 1);
}

.ml-char-card:hover {
  border-color: var(--lumiverse-border-hover, rgba(147, 112, 219, 0.45));
  transform: translateY(-2px);
  box-shadow:
    var(--lumiverse-shadow-md, 0 8px 20px rgba(0, 0, 0, 0.36)),
    0 0 0 1px var(--lumiverse-primary-015, rgba(147, 112, 219, 0.2));
}

.ml-char-card-thumb-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 5;
  background: var(--lumiverse-card-image-bg, linear-gradient(135deg, rgba(20, 17, 28, 1) 0%, rgba(28, 22, 40, 1) 100%));
  overflow: hidden;
  contain: layout paint style;
}

.ml-char-card-scrim {
  position: absolute;
  inset: auto 0 0 0;
  height: 52%;
  pointer-events: none;
  background: linear-gradient(
    to top,
    rgba(10, 8, 18, 0.94) 0%,
    rgba(10, 8, 18, 0.72) 45%,
    transparent 100%
  );
  z-index: 1;
}

.ml-char-card-badges {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  max-width: calc(100% - 30px);
  pointer-events: none;
}

.ml-char-card-badges .ml-tile-badge {
  position: static;
}

.ml-char-card-edit-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 3;
  width: 22px;
  height: 22px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(10, 8, 18, 0.84);
  color: #f1f5f9;
  cursor: pointer;
  opacity: 0.72;
  transition:
    background var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease),
    color var(--lumiverse-transition-fast, 150ms ease),
    opacity var(--lumiverse-transition-fast, 150ms ease);
}

.ml-char-card:hover .ml-char-card-edit-btn,
.ml-char-card:focus-within .ml-char-card-edit-btn {
  opacity: 1;
}

.ml-char-card-edit-btn:hover {
  opacity: 1;
  background: var(--lumiverse-primary, rgba(147, 112, 219, 0.92));
  border-color: rgba(255, 255, 255, 0.45);
  color: #ffffff;
}

.ml-char-card-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}

.ml-char-card:hover .ml-char-card-thumb {
  transform: scale(1.05);
}

.ml-char-card-placeholder {
  width: 100%;
  height: 100%;
  padding-bottom: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--lumiverse-primary-muted, rgba(147, 112, 219, 0.65));
}

.ml-char-card-footer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 2;
  padding: 5px 6px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  pointer-events: none;
}

.ml-char-card-footer .ml-url-sources {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: rgba(255, 255, 255, 0.76);
  font-size: 10px;
}

.ml-char-card-name {
  font-weight: 600;
  font-size: 11px;
  color: #ffffff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ml-widget.is-thumb-sm .ml-char-card-badges {
  top: 3px;
  left: 3px;
  gap: 2px;
  max-width: calc(100% - 24px);
}

.ml-widget.is-thumb-sm .ml-tile-badge {
  bottom: 3px;
  left: 3px;
  padding: 1px 4px;
  font-size: 9px;
}

.ml-widget.is-thumb-sm .ml-char-card-edit-btn {
  top: 3px;
  right: 3px;
  width: 19px;
  height: 19px;
}

.ml-widget.is-thumb-sm .ml-char-card-footer {
  padding: 4px 5px;
}

.ml-widget.is-thumb-sm .ml-char-card-name {
  font-size: 10.5px;
}

.ml-widget.is-thumb-sm .ml-char-card-footer .ml-url-sources {
  font-size: 9.5px;
}

.ml-widget.is-thumb-sm .ml-media-list-kind-badge {
  width: 12px;
  height: 12px;
}

.ml-widget.is-thumb-lg .ml-char-card-footer {
  padding: 6px 8px;
  gap: 2px;
}

.ml-widget.is-thumb-lg .ml-char-card-name {
  font-size: 12px;
}

.ml-gallery-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px 6px;
  flex-wrap: wrap;
  padding: 2px 0 0;
}

.ml-gallery-pagination-info {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
  font-variant-numeric: tabular-nums;
}

.ml-gallery-pagination-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* Shared Lightbox */
.ml-lightbox-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--lumiverse-z-lightbox, 10005);
  background: var(--lumiverse-modal-backdrop, rgba(5, 4, 12, 0.86));
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}

.ml-lightbox-dialog {
  width: min(92vw, 920px);
  max-height: 92vh;
  background: var(--lumiverse-gradient-modal, linear-gradient(135deg, rgba(35, 30, 48, 0.98), rgba(20, 17, 28, 0.98)));
  border: 1px solid var(--lumiverse-border-hover, rgba(147, 112, 219, 0.25));
  border-radius: var(--lumiverse-radius-lg, 12px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--lumiverse-shadow-xl, 0 20px 60px rgba(0, 0, 0, 0.6));
}

.ml-lightbox-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  border-bottom: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
  background: var(--lumiverse-bg-dark, rgba(0, 0, 0, 0.2));
}

.ml-lightbox-counter {
  font-size: 11.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.7));
}

.ml-lightbox-stage {
  flex: 1;
  min-height: 220px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px;
  background: radial-gradient(circle at center, rgba(24, 20, 36, 0.9) 0%, rgba(8, 6, 14, 0.95) 100%);
  overflow: hidden;
}

.ml-lightbox-media-slot {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ml-lightbox-media {
  max-width: 100%;
  max-height: 68vh;
  object-fit: contain;
  border-radius: var(--lumiverse-radius, 8px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}

.ml-lightbox-nav {
  flex-shrink: 0;
  padding: 7px;
  border-radius: 999px;
  background: rgba(15, 12, 24, 0.72);
  border-color: rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(4px);
}

.ml-lightbox-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
  background: var(--lumiverse-bg-dark, rgba(0, 0, 0, 0.22));
}

.ml-lightbox-meta {
  flex: 1;
  min-width: min(100%, 150px);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ml-lightbox-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 12.5px;
  color: var(--lumiverse-text, #f8fafc);
}

/* Portrait Panel Quick Localize Pill */
.ml-portrait-localize-wrap {
  display: flex;
  justify-content: center;
  width: 100%;
  margin: 4px 0 2px;
}

.ml-portrait-localize-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 3.5px 11px;
  border-radius: 999px;
  border: 1px solid var(--lumiverse-primary-050, rgba(147, 112, 219, 0.48));
  background: var(--lumiverse-primary-015, rgba(147, 112, 219, 0.18));
  color: var(--lumiverse-primary-text, #e9d5ff);
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
  transition:
    background-color var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease),
    color var(--lumiverse-transition-fast, 150ms ease),
    opacity var(--lumiverse-transition-fast, 150ms ease);
}

.ml-portrait-localize-btn:hover {
  background: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.3));
  border-color: var(--lumiverse-primary-hover, rgba(167, 132, 239, 0.8));
  color: #ffffff;
}

.ml-portrait-localize-btn.is-running {
  border-color: var(--lumiverse-primary, rgba(147, 112, 219, 0.7));
  background: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.25));
}

.ml-portrait-localize-btn.is-done {
  border-color: var(--lumiverse-success-050, rgba(34, 197, 94, 0.55));
  background: var(--lumiverse-success-020, rgba(34, 197, 94, 0.2));
  color: #86efac;
}
`;
