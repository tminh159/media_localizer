export const MEDIA_LOCALIZER_STYLES = `
/* Hide the rudimentary native 1-click "Import All" extract bar inside the Character Editor Gallery tab when Media Localizer is mounted */
.ml-gallery-tab-active > [class*="galleryExtract"] {
  display: none;
}

/* Allow the native galleryTab to scroll smoothly when the Media Localizer panel is expanded */
[class*="galleryTab"].ml-gallery-tab-active {
  overflow-y: auto;
}

.ml-gallery-host {
  margin-top: 12px;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.12));
  border-radius: 10px;
  background: var(--lumiverse-bg-elevated, rgba(20, 22, 28, 0.85));
  color: var(--lumiverse-text, #f1f5f9);
  font-size: 12.5px;
  line-height: 1.45;
  flex-shrink: 0;
  overflow: hidden;
}

.ml-drawer-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: var(--lumiverse-text, #f1f5f9);
  font-size: 12.5px;
  line-height: 1.45;
  overflow: hidden;
}

.ml-drawer-nav {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.1));
  background: var(--lumiverse-bg-surface, rgba(15, 17, 23, 0.6));
  flex-shrink: 0;
}

.ml-drawer-nav-btn {
  flex: 1;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--lumiverse-text-muted, #94a3b8);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.ml-drawer-nav-btn:hover {
  color: var(--lumiverse-text, #f1f5f9);
  background: rgba(255, 255, 255, 0.05);
}

.ml-drawer-nav-btn.is-active {
  color: var(--lumiverse-text, #ffffff);
  background: var(--lumiverse-bg-elevated, rgba(255, 255, 255, 0.1));
  border-color: var(--lumiverse-border, rgba(255, 255, 255, 0.16));
}

.ml-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ml-widget {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.ml-header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.ml-header-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 180px;
}

.ml-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 13px;
  color: var(--lumiverse-text, #f8fafc);
}

.ml-subtitle {
  font-size: 11.5px;
  color: var(--lumiverse-text-muted, #94a3b8);
}

.ml-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.ml-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.08);
  color: var(--lumiverse-text, #e2e8f0);
}

.ml-badge.is-success {
  background: rgba(16, 185, 129, 0.16);
  color: #34d399;
}

.ml-badge.is-warn {
  background: rgba(245, 158, 11, 0.16);
  color: #fbbf24;
}

.ml-badge.is-danger {
  background: rgba(239, 68, 68, 0.16);
  color: #f87171;
}

.ml-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.14));
  background: var(--lumiverse-bg-surface, rgba(255, 255, 255, 0.06));
  color: var(--lumiverse-text, #f1f5f9);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.ml-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}

.ml-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ml-btn.is-primary {
  background: var(--lumiverse-primary, #6366f1);
  border-color: var(--lumiverse-primary, #6366f1);
  color: #ffffff;
}

.ml-btn.is-primary:hover:not(:disabled) {
  filter: brightness(1.1);
}

.ml-btn.is-danger {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.35);
  color: #fca5a5;
}

.ml-btn.is-danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.25);
}

.ml-btn.is-sm {
  padding: 3px 7px;
  font-size: 11px;
}

.ml-toggle-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  color: var(--lumiverse-text, #e2e8f0);
}

.ml-section,
.ml-section-box {
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
  padding: 10px;
  background: rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ml-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--lumiverse-text-muted, #94a3b8);
}

.ml-check-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(195px, 1fr));
  gap: 6px;
}

.ml-check-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.08));
  background: rgba(255, 255, 255, 0.03);
  font-size: 12px;
}

.ml-check-card.is-empty {
  opacity: 0.5;
}

.ml-check-card-left {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ml-subfilter-box {
  margin-top: 4px;
  padding: 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px dashed var(--lumiverse-border, rgba(255, 255, 255, 0.12));
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ml-subfilter-list {
  max-height: 150px;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 4px;
}

.ml-pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ml-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.14));
  background: rgba(255, 255, 255, 0.04);
  color: var(--lumiverse-text, #f1f5f9);
  font-family: inherit;
  font-size: 11.5px;
  cursor: pointer;
  user-select: none;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.ml-pill:hover {
  background: rgba(255, 255, 255, 0.09);
}

.ml-pill.is-selected {
  background: rgba(99, 102, 241, 0.2);
  border-color: rgba(99, 102, 241, 0.55);
  color: #e0e7ff;
}

.ml-url-list {
  max-height: 280px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-right: 2px;
}

.ml-url-item-card,
.ml-lib-item-card {
  display: flex;
  flex-direction: column;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  transition: border-color 0.15s ease, background 0.15s ease;
}

.ml-url-item-card:hover,
.ml-lib-item-card:hover {
  border-color: rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.045);
}

.ml-url-item-card.is-expanded,
.ml-lib-item-card.is-expanded {
  border-color: rgba(99, 102, 241, 0.45);
  background: rgba(99, 102, 241, 0.06);
}

.ml-url-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  font-size: 11.5px;
  cursor: pointer;
  user-select: none;
}

.ml-row-checkbox {
  cursor: pointer;
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  margin: 0;
}

.ml-url-thumb {
  width: 34px;
  height: 34px;
  border-radius: 4px;
  object-fit: cover;
  background: rgba(0, 0, 0, 0.4);
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
  color: var(--lumiverse-text, #f1f5f9);
  font-family: monospace;
  font-size: 11px;
}

.ml-url-sources {
  font-size: 10.5px;
  color: var(--lumiverse-text-muted, #94a3b8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ml-expand-hint {
  font-size: 10.5px;
  color: var(--lumiverse-text-muted, #94a3b8);
  padding: 2px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
  flex-shrink: 0;
}

.ml-item-details {
  padding: 8px 10px 10px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.28);
  border-bottom-left-radius: 6px;
  border-bottom-right-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 11.5px;
}

.ml-detail-top {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.ml-detail-preview-box {
  width: 120px;
  min-height: 76px;
  max-height: 140px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
  position: relative;
}

.ml-detail-preview-media {
  max-width: 120px;
  max-height: 120px;
  object-fit: contain;
  display: block;
  cursor: pointer;
}

.ml-detail-preview-caption {
  font-size: 10px;
  color: var(--lumiverse-text-muted, #94a3b8);
  padding: 2px 4px;
  text-align: center;
  width: 100%;
  background: rgba(0, 0, 0, 0.55);
}

.ml-detail-info-col {
  flex: 1;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ml-detail-url-box {
  font-family: monospace;
  font-size: 11px;
  word-break: break-all;
  padding: 5px 7px;
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--lumiverse-text, #f8fafc);
  user-select: text;
}

.ml-detail-kv-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.ml-detail-source-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.ml-detail-source-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10.5px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--lumiverse-text, #e2e8f0);
}

.ml-detail-error-box {
  padding: 5px 7px;
  border-radius: 5px;
  background: rgba(239, 68, 68, 0.14);
  border: 1px solid rgba(239, 68, 68, 0.35);
  color: #fca5a5;
  font-size: 11px;
}

.ml-download-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding-top: 6px;
  border-top: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.1));
}

.ml-select {
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.16));
  background: var(--lumiverse-bg-surface, #1e293b);
  color: var(--lumiverse-text, #f1f5f9);
  font-size: 12px;
}

.ml-input-num {
  width: 68px;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.16));
  background: var(--lumiverse-bg-surface, #1e293b);
  color: var(--lumiverse-text, #f1f5f9);
  font-size: 12px;
}

.ml-queue-banner {
  border: 1px solid rgba(99, 102, 241, 0.45);
  background: rgba(99, 102, 241, 0.1);
  border-radius: 8px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ml-progress-track {
  width: 100%;
  height: 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}

.ml-progress-fill {
  height: 100%;
  background: var(--lumiverse-primary, #6366f1);
  transition: width 0.2s ease;
}

.ml-asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(115px, 1fr));
  gap: 8px;
  max-height: 280px;
  overflow-y: auto;
  padding: 2px;
}

.ml-asset-card {
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.1));
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.25);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ml-asset-preview {
  width: 100%;
  height: 84px;
  object-fit: cover;
  background: rgba(0, 0, 0, 0.4);
  cursor: pointer;
}

.ml-asset-footer {
  padding: 5px 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 10.5px;
}

.ml-asset-actions {
  display: flex;
  gap: 4px;
}

.ml-asset-actions .ml-btn {
  flex: 1;
  padding: 2px 4px;
  font-size: 10px;
}

.ml-lib-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 9px;
  cursor: pointer;
  user-select: none;
}

.ml-drawer-sticky-banner {
  padding: 8px 12px 0;
  flex-shrink: 0;
}

.ml-drawer-sticky-banner:empty {
  display: none;
}

.ml-badge.is-info {
  background: rgba(99, 102, 241, 0.18);
  color: #a5b4fc;
}

.ml-btn.is-active {
  background: rgba(99, 102, 241, 0.24);
  border-color: rgba(99, 102, 241, 0.55);
  color: #ffffff;
}

.ml-btn.is-xs {
  padding: 2px 5px;
  font-size: 10px;
}

.ml-icon-btn {
  padding: 4px 6px;
}

.ml-icon-btn.is-sm {
  padding: 3px 5px;
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

.ml-inline-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.ml-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--lumiverse-text, #f8fafc);
}

.ml-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ml-config-label-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ml-config-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--lumiverse-text-muted, #94a3b8);
}

.ml-checkbox-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  align-items: center;
}

.ml-checkbox-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--lumiverse-text, #e2e8f0);
  cursor: pointer;
  user-select: none;
}

.ml-setting-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ml-select.is-sm {
  padding: 3px 6px;
  font-size: 11px;
}

.ml-input-text {
  flex: 1;
  min-width: 140px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.16));
  background: var(--lumiverse-bg-surface, #1e293b);
  color: var(--lumiverse-text, #f1f5f9);
  font-size: 12px;
}

.ml-error-banner {
  padding: 8px 10px;
  border-radius: 7px;
  background: rgba(239, 68, 68, 0.14);
  border: 1px solid rgba(239, 68, 68, 0.35);
  color: #fca5a5;
  font-size: 12px;
}

.ml-empty {
  text-align: center;
  color: var(--lumiverse-text-muted, #94a3b8);
  padding: 16px 10px;
  font-size: 12px;
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
  color: var(--lumiverse-text-muted, #94a3b8);
  cursor: pointer;
  opacity: 0.8;
}

.ml-tip-btn:hover,
.ml-tip-wrap.is-open .ml-tip-btn {
  opacity: 1;
  color: var(--lumiverse-text, #f8fafc);
  background: rgba(255, 255, 255, 0.08);
}

.ml-tip-popover {
  display: none;
  position: absolute;
  left: 50%;
  top: calc(100% + 6px);
  transform: translateX(-50%);
  width: max-content;
  max-width: min(240px, 65vw);
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.97);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #f1f5f9;
  font-size: 11px;
  font-weight: 400;
  text-transform: none;
  letter-spacing: normal;
  line-height: 1.4;
  white-space: normal;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
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

/* Active Character Header */
.ml-char-identity {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ml-char-avatar {
  width: 42px;
  height: 42px;
  border-radius: 8px;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, 0.15);
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.35);
}

.ml-char-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ml-status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.ml-options-panel {
  border-color: rgba(99, 102, 241, 0.35);
  background: rgba(99, 102, 241, 0.05);
}

/* Failed Items Recovery Panel */
.ml-failed-panel {
  border-color: rgba(239, 68, 68, 0.32);
  background: rgba(239, 68, 68, 0.05);
}

.ml-failed-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
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
  gap: 8px;
  padding: 5px 7px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.07);
}

.ml-failed-url-col {
  flex: 1;
  min-width: 0;
}

/* Media Tiles & List View */
.ml-asset-thumb-wrap {
  position: relative;
  width: 100%;
  height: 92px;
  background: rgba(0, 0, 0, 0.4);
  cursor: pointer;
  overflow: hidden;
}

.ml-asset-thumb-wrap .ml-asset-preview {
  height: 100%;
}

.ml-tile-badge {
  position: absolute;
  top: 4px;
  left: 4px;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 9.5px;
  font-weight: 600;
  background: rgba(15, 23, 42, 0.82);
  color: #e2e8f0;
  border: 1px solid rgba(255, 255, 255, 0.14);
  pointer-events: none;
}

.ml-tile-badge.is-info {
  background: rgba(79, 70, 229, 0.86);
  color: #ffffff;
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
  gap: 5px;
  max-height: 460px;
  overflow-y: auto;
}

.ml-media-list-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 7px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.08));
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
}

.ml-media-list-row:hover {
  background: rgba(255, 255, 255, 0.07);
}

.ml-media-list-thumb {
  width: 40px;
  height: 40px;
  border-radius: 5px;
  object-fit: cover;
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.35);
}

/* Whole-Library Gallery */
.ml-gallery-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.ml-sort-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.ml-gallery-type-pills {
  margin-top: 6px;
}

.ml-drawer-root .ml-asset-grid,
.ml-gallery-grid {
  max-height: none;
}

.ml-char-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
  gap: 8px;
}

.ml-char-card {
  display: flex;
  flex-direction: column;
  padding: 0;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.12));
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.28);
  color: inherit;
  text-align: left;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.12s ease, border-color 0.12s ease;
}

.ml-char-card:hover {
  border-color: var(--lumiverse-primary, #6366f1);
  transform: translateY(-1px);
}

.ml-char-card-thumb-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  background: rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.ml-char-card-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ml-char-card-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--lumiverse-text-muted, #64748b);
}

.ml-char-card-footer {
  padding: 6px 7px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ml-char-card-name {
  font-weight: 600;
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Shared Lightbox */
.ml-lightbox-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--lumiverse-z-lightbox, 2200);
  background: rgba(5, 8, 16, 0.88);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.ml-lightbox-dialog {
  width: min(92vw, 920px);
  max-height: 92vh;
  background: var(--lumiverse-bg-elevated, #0f172a);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.65);
}

.ml-lightbox-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.ml-lightbox-counter {
  font-size: 12px;
  color: var(--lumiverse-text-muted, #94a3b8);
}

.ml-lightbox-stage {
  flex: 1;
  min-height: 220px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.45);
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
  border-radius: 6px;
}

.ml-lightbox-nav {
  flex-shrink: 0;
  padding: 8px;
}

.ml-lightbox-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.ml-lightbox-meta {
  flex: 1;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  gap: 3px;
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
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid rgba(99, 102, 241, 0.48);
  background: rgba(99, 102, 241, 0.18);
  color: #e0e7ff;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.ml-portrait-localize-btn:hover {
  background: rgba(99, 102, 241, 0.34);
  border-color: rgba(129, 140, 248, 0.8);
  color: #ffffff;
}

.ml-portrait-localize-btn.is-running {
  border-color: rgba(99, 102, 241, 0.7);
  background: rgba(99, 102, 241, 0.25);
}

.ml-portrait-localize-btn.is-done {
  border-color: rgba(16, 185, 129, 0.55);
  background: rgba(16, 185, 129, 0.2);
  color: #6ee7b7;
}
`;

