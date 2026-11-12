/* eslint-disable @typescript-eslint/no-explicit-any */

export interface MockEventListenerEntry {
    type: string;
    listener: (event: any) => void;
    capture: boolean;
}

export class MockEvent {
    readonly type: string;
    readonly bubbles: boolean;
    readonly cancelable: boolean;
    defaultPrevented = false;
    propagationStopped = false;
    immediatePropagationStopped = false;
    target: any = null;
    currentTarget: any = null;

    constructor(type: string, init?: { bubbles?: boolean; cancelable?: boolean }) {
        this.type = type;
        this.bubbles = Boolean(init?.bubbles);
        this.cancelable = Boolean(init?.cancelable);
    }

    preventDefault(): void {
        if (this.cancelable) {
            this.defaultPrevented = true;
        }
    }

    stopPropagation(): void {
        this.propagationStopped = true;
    }

    stopImmediatePropagation(): void {
        this.immediatePropagationStopped = true;
        this.propagationStopped = true;
    }
}

export class MockCustomEvent<T = unknown> extends MockEvent {
    readonly detail: T | undefined;

    constructor(type: string, init?: { bubbles?: boolean; cancelable?: boolean; detail?: T }) {
        super(type, init);
        this.detail = init?.detail;
    }
}

export class MockKeyboardEvent extends MockEvent {
    readonly key: string;

    constructor(type: string, init?: { bubbles?: boolean; cancelable?: boolean; key?: string }) {
        super(type, init);
        this.key = init?.key ?? "";
    }
}

export class MockEventTarget {
    private _listeners: MockEventListenerEntry[] = [];

    addEventListener(
        type: string,
        listener: ((event: any) => void) | { handleEvent?: (event: any) => void } | null,
        options?: boolean | { capture?: boolean; once?: boolean; passive?: boolean },
    ): void {
        if (!listener) return;
        const fn =
            typeof listener === "function"
                ? listener
                : (event: any) => listener.handleEvent?.(event);
        const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
        const exists = this._listeners.some(
            (e) => e.type === type && e.listener === fn && e.capture === capture,
        );
        if (exists) return;

        if (typeof options === "object" && options?.once) {
            const wrapped = (event: any): void => {
                this.removeEventListener(type, wrapped, capture);
                fn(event);
            };
            this._listeners.push({ type, listener: wrapped, capture });
            return;
        }
        this._listeners.push({ type, listener: fn, capture });
    }

    removeEventListener(
        type: string,
        listener: ((event: any) => void) | { handleEvent?: (event: any) => void } | null,
        options?: boolean | { capture?: boolean },
    ): void {
        if (!listener || typeof listener !== "function") return;
        const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
        this._listeners = this._listeners.filter(
            (e) => !(e.type === type && e.listener === listener && e.capture === capture),
        );
    }

    getListenerCount(type?: string): number {
        if (!type) return this._listeners.length;
        return this._listeners.filter((e) => e.type === type).length;
    }

    _invokeListeners(event: MockEvent, capturePhase: boolean): void {
        const snapshot = this._listeners.filter(
            (e) => e.type === event.type && e.capture === capturePhase,
        );
        for (const entry of snapshot) {
            if (event.immediatePropagationStopped) break;
            entry.listener.call(this, event);
        }
    }

    dispatchEvent(event: MockEvent): boolean {
        if (!event.target) {
            event.target = this;
        }
        event.currentTarget = this;
        this._invokeListeners(event, true);
        if (!event.immediatePropagationStopped) {
            this._invokeListeners(event, false);
        }
        return !event.defaultPrevented;
    }
}

export class MockNode extends MockEventTarget {
    readonly nodeType: number;
    parentNode: MockNode | null = null;
    childNodes: MockNode[] = [];
    ownerDocument: MockDocument | null = null;

    constructor(nodeType: number, ownerDocument: MockDocument | null = null) {
        super();
        this.nodeType = nodeType;
        this.ownerDocument = ownerDocument;
    }

    get parentElement(): MockElement | null {
        return this.parentNode instanceof MockElement ? this.parentNode : null;
    }

    get firstChild(): MockNode | null {
        return this.childNodes[0] ?? null;
    }

    get lastChild(): MockNode | null {
        return this.childNodes.length > 0 ? (this.childNodes[this.childNodes.length - 1] ?? null) : null;
    }

    get isConnected(): boolean {
        let cur: MockNode | null = this;
        while (cur) {
            if (this.ownerDocument && (cur === this.ownerDocument || cur === this.ownerDocument.documentElement)) {
                return true;
            }
            cur = cur.parentNode;
        }
        return false;
    }

    appendChild<T extends MockNode>(child: T): T {
        if (child.nodeType === 11) {
            const kids = [...child.childNodes];
            for (const kid of kids) {
                this.appendChild(kid);
            }
            return child;
        }
        if (child.parentNode) {
            child.parentNode.removeChild(child);
        }
        child.parentNode = this;
        this._propagateOwnerDocument(child);
        this.childNodes.push(child);
        return child;
    }

    insertBefore<T extends MockNode>(newNode: T, refNode: MockNode | null): T {
        if (!refNode) {
            return this.appendChild(newNode);
        }
        if (newNode.nodeType === 11) {
            const kids = [...newNode.childNodes];
            for (const kid of kids) {
                this.insertBefore(kid, refNode);
            }
            return newNode;
        }
        if (newNode.parentNode) {
            newNode.parentNode.removeChild(newNode);
        }
        const idx = this.childNodes.indexOf(refNode);
        newNode.parentNode = this;
        this._propagateOwnerDocument(newNode);
        if (idx < 0) {
            this.childNodes.push(newNode);
        } else {
            this.childNodes.splice(idx, 0, newNode);
        }
        return newNode;
    }

    removeChild<T extends MockNode>(child: T): T {
        const idx = this.childNodes.indexOf(child);
        if (idx >= 0) {
            this.childNodes.splice(idx, 1);
            child.parentNode = null;
        }
        return child;
    }

    replaceChildren(...nodes: Array<MockNode | string>): void {
        for (const existing of [...this.childNodes]) {
            existing.parentNode = null;
        }
        this.childNodes = [];
        this.append(...nodes);
    }

    append(...nodes: Array<MockNode | string>): void {
        for (const node of nodes) {
            if (typeof node === "string") {
                this.appendChild(new MockTextNode(node, this.ownerDocument));
            } else {
                this.appendChild(node);
            }
        }
    }

    remove(): void {
        if (this.parentNode) {
            this.parentNode.removeChild(this);
        }
    }

    replaceWith(...nodes: Array<MockNode | string>): void {
        const parent = this.parentNode;
        if (!parent) return;
        for (const n of nodes) {
            const node = typeof n === "string" ? new MockTextNode(n, this.ownerDocument) : n;
            parent.insertBefore(node, this);
        }
        parent.removeChild(this);
    }

    contains(other: MockNode | null): boolean {
        let cur: MockNode | null = other;
        while (cur) {
            if (cur === this) return true;
            cur = cur.parentNode;
        }
        return false;
    }

    get textContent(): string {
        return this.childNodes.map((n) => n.textContent).join("");
    }

    set textContent(value: string) {
        for (const existing of [...this.childNodes]) {
            existing.parentNode = null;
        }
        this.childNodes = [];
        if (value !== "" && value != null) {
            this.appendChild(new MockTextNode(String(value), this.ownerDocument));
        }
    }

    protected _propagateOwnerDocument(node: MockNode): void {
        if (!this.ownerDocument) return;
        node.ownerDocument = this.ownerDocument;
        for (const child of node.childNodes) {
            this._propagateOwnerDocument(child);
        }
    }
}

export class MockTextNode extends MockNode {
    data: string;

    constructor(data: string, ownerDocument: MockDocument | null = null) {
        super(3, ownerDocument);
        this.data = String(data);
    }

    override get textContent(): string {
        return this.data;
    }

    override set textContent(value: string) {
        this.data = String(value ?? "");
    }
}

export class MockDocumentFragment extends MockNode {
    constructor(ownerDocument: MockDocument | null = null) {
        super(11, ownerDocument);
    }
}

function toCamelCase(attrName: string): string {
    return attrName.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

function toKebabCase(propName: string): string {
    return propName.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

export class MockClassList {
    private readonly el: MockElement;

    constructor(el: MockElement) {
        this.el = el;
    }

    private getSet(): Set<string> {
        const raw = this.el.getAttribute("class") ?? "";
        const tokens = raw.split(/\s+/).map((s) => s.trim()).filter(Boolean);
        return new Set(tokens);
    }

    private commit(set: Set<string>): void {
        const next = Array.from(set).join(" ");
        if (next) {
            this.el._rawSetAttribute("class", next);
        } else {
            this.el._rawRemoveAttribute("class");
        }
    }

    add(...tokens: string[]): void {
        const set = this.getSet();
        for (const token of tokens) {
            if (token) set.add(token);
        }
        this.commit(set);
    }

    remove(...tokens: string[]): void {
        const set = this.getSet();
        for (const token of tokens) {
            set.delete(token);
        }
        this.commit(set);
    }

    contains(token: string): boolean {
        return this.getSet().has(token);
    }

    toggle(token: string, force?: boolean): boolean {
        const set = this.getSet();
        const has = set.has(token);
        const shouldAdd = force !== undefined ? Boolean(force) : !has;
        if (shouldAdd) {
            set.add(token);
        } else {
            set.delete(token);
        }
        this.commit(set);
        return shouldAdd;
    }
}

function createStyleProxy(el: MockElement): any {
    const props = new Map<string, string>();

    const normalizeKey = (k: string): string => {
        if (k.includes("-")) return k.toLowerCase();
        return toKebabCase(k);
    };

    const serialize = (): string => {
        const parts: string[] = [];
        for (const [k, v] of props.entries()) {
            if (v !== "") parts.push(`${k}: ${v}`);
        }
        return parts.join("; ");
    };

    const syncAttr = (): void => {
        const css = serialize();
        if (css) {
            el._rawSetAttribute("style", css);
        } else {
            el._rawRemoveAttribute("style");
        }
    };

    const parseCssText = (text: string): void => {
        props.clear();
        const decls = String(text ?? "").split(";");
        for (const decl of decls) {
            const idx = decl.indexOf(":");
            if (idx <= 0) continue;
            const key = decl.slice(0, idx).trim().toLowerCase();
            const val = decl.slice(idx + 1).trim();
            if (key && val) props.set(key, val);
        }
        syncAttr();
    };

    const target: Record<string, any> = {
        setProperty(name: string, value: string): void {
            const key = normalizeKey(name);
            if (!value) props.delete(key);
            else props.set(key, String(value));
            syncAttr();
        },
        getPropertyValue(name: string): string {
            return props.get(normalizeKey(name)) ?? "";
        },
        removeProperty(name: string): string {
            const key = normalizeKey(name);
            const prev = props.get(key) ?? "";
            props.delete(key);
            syncAttr();
            return prev;
        },
        _syncFromAttribute(raw: string | null): void {
            props.clear();
            if (!raw) return;
            for (const decl of raw.split(";")) {
                const idx = decl.indexOf(":");
                if (idx <= 0) continue;
                const key = decl.slice(0, idx).trim().toLowerCase();
                const val = decl.slice(idx + 1).trim();
                if (key && val) props.set(key, val);
            }
        },
    };

    return new Proxy(target, {
        get(t, prop) {
            if (typeof prop === "symbol") return (t as any)[prop];
            if (prop === "cssText") return serialize();
            if (prop in t) return t[prop];
            return props.get(normalizeKey(prop)) ?? "";
        },
        set(_t, prop, value) {
            if (typeof prop === "symbol") return false;
            if (prop === "cssText") {
                parseCssText(String(value ?? ""));
                return true;
            }
            const key = normalizeKey(prop);
            const str = value == null ? "" : String(value);
            if (str === "") props.delete(key);
            else props.set(key, str);
            syncAttr();
            return true;
        },
    });
}

function parseSimpleHtmlInto(parent: MockElement, html: string, doc: MockDocument | null): void {
    const src = String(html ?? "");
    const stack: MockElement[] = [parent];
    let i = 0;
    const voidTags = new Set(["img", "input", "br", "hr", "source", "meta", "link"]);

    while (i < src.length) {
        const lt = src.indexOf("<", i);
        if (lt === -1) {
            const text = src.slice(i);
            if (text) {
                stack[stack.length - 1]?.appendChild(new MockTextNode(text, doc));
            }
            break;
        }
        if (lt > i) {
            const text = src.slice(i, lt);
            stack[stack.length - 1]?.appendChild(new MockTextNode(text, doc));
        }

        const gt = src.indexOf(">", lt + 1);
        if (gt === -1) {
            stack[stack.length - 1]?.appendChild(new MockTextNode(src.slice(lt), doc));
            break;
        }

        const tagContent = src.slice(lt + 1, gt).trim();
        i = gt + 1;

        if (!tagContent || tagContent.startsWith("!") || tagContent.startsWith("?")) {
            continue;
        }
        if (tagContent.startsWith("/")) {
            const closeName = tagContent.slice(1).trim().toLowerCase();
            for (let s = stack.length - 1; s >= 1; s--) {
                if (stack[s]?.tagName.toLowerCase() === closeName) {
                    stack.length = s;
                    break;
                }
            }
            continue;
        }

        const selfClosing = tagContent.endsWith("/");
        const body = selfClosing ? tagContent.slice(0, -1).trim() : tagContent;
        const spaceIdx = body.search(/\s/);
        const tagName = (spaceIdx === -1 ? body : body.slice(0, spaceIdx)).toLowerCase();
        const attrPart = spaceIdx === -1 ? "" : body.slice(spaceIdx + 1);

        const el = doc ? doc.createElement(tagName) : new MockElement(tagName, null);
        const attrRe = /([a-zA-Z_:@-][a-zA-Z0-9_.:@-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
        let match: RegExpExecArray | null;
        while ((match = attrRe.exec(attrPart)) !== null) {
            const attrName = match[1];
            if (!attrName) continue;
            const attrVal = match[2] ?? match[3] ?? match[4] ?? "";
            el.setAttribute(attrName, attrVal);
        }

        stack[stack.length - 1]?.appendChild(el);
        if (!selfClosing && !voidTags.has(tagName)) {
            stack.push(el);
        }
    }
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function serializeChildHtml(node: MockNode): string {
    if (node.nodeType === 3) {
        return escapeHtml((node as MockTextNode).data);
    }
    if (node instanceof MockElement) {
        const tag = node.tagName.toLowerCase();
        const attrs = Array.from(node._attributes.entries())
            .map(([k, v]) => (v === "" ? k : `${k}="${v.replace(/"/g, "&quot;")}"`))
            .join(" ");
        const open = attrs ? `<${tag} ${attrs}>` : `<${tag}>`;
        const childrenHtml = node.childNodes.map(serializeChildHtml).join("");
        return `${open}${childrenHtml}</${tag}>`;
    }
    return node.childNodes.map(serializeChildHtml).join("");
}

function splitTopLevelCommas(selector: string): string[] {
    const parts: string[] = [];
    let current = "";
    let bracketDepth = 0;
    let parenDepth = 0;
    let quote: string | null = null;
    for (let i = 0; i < selector.length; i++) {
        const ch = selector[i]!;
        if (quote) {
            current += ch;
            if (ch === quote && selector[i - 1] !== "\\") quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            current += ch;
        } else if (ch === "[") {
            bracketDepth++;
            current += ch;
        } else if (ch === "]") {
            bracketDepth = Math.max(0, bracketDepth - 1);
            current += ch;
        } else if (ch === "(") {
            parenDepth++;
            current += ch;
        } else if (ch === ")") {
            parenDepth = Math.max(0, parenDepth - 1);
            current += ch;
        } else if (ch === "," && bracketDepth === 0 && parenDepth === 0) {
            if (current.trim()) parts.push(current.trim());
            current = "";
        } else {
            current += ch;
        }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
}

function parseCombinatorChain(selector: string): Array<{ comb: "desc" | "child" | null; compound: string }> {
    const tokens: Array<{ comb: "desc" | "child" | null; compound: string }> = [];
    let current = "";
    let nextComb: "desc" | "child" | null = null;
    let bracketDepth = 0;
    let parenDepth = 0;
    let quote: string | null = null;

    const flush = (): void => {
        if (current) {
            tokens.push({ comb: nextComb, compound: current });
            current = "";
            nextComb = null;
        }
    };

    for (let i = 0; i < selector.length; i++) {
        const ch = selector[i]!;
        if (quote) {
            current += ch;
            if (ch === quote && selector[i - 1] !== "\\") quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            current += ch;
        } else if (ch === "[") {
            bracketDepth++;
            current += ch;
        } else if (ch === "]") {
            bracketDepth = Math.max(0, bracketDepth - 1);
            current += ch;
        } else if (ch === "(") {
            parenDepth++;
            current += ch;
        } else if (ch === ")") {
            parenDepth = Math.max(0, parenDepth - 1);
            current += ch;
        } else if (bracketDepth === 0 && parenDepth === 0 && ch === ">") {
            flush();
            nextComb = "child";
        } else if (bracketDepth === 0 && parenDepth === 0 && /\s/.test(ch)) {
            if (current) {
                flush();
                nextComb = "desc";
            }
        } else {
            current += ch;
        }
    }
    flush();
    return tokens;
}

function matchesSingleCompound(el: MockElement, compound: string): boolean {
    let i = 0;
    while (i < compound.length) {
        const ch = compound[i]!;
        if (ch === "*") {
            i++;
            continue;
        }
        if (ch === ".") {
            let j = i + 1;
            while (j < compound.length && /[a-zA-Z0-9_-]/.test(compound[j]!)) j++;
            const cls = compound.slice(i + 1, j);
            if (!cls || !el.classList.contains(cls)) return false;
            i = j;
            continue;
        }
        if (ch === "#") {
            let j = i + 1;
            while (j < compound.length && /[a-zA-Z0-9_:-]/.test(compound[j]!)) j++;
            const id = compound.slice(i + 1, j);
            if (!id || el.id !== id) return false;
            i = j;
            continue;
        }
        if (ch === "[") {
            const close = compound.indexOf("]", i + 1);
            if (close === -1) return false;
            const inner = compound.slice(i + 1, close).trim();
            const opMatch = /^([a-zA-Z0-9_.:@-]+)\s*([*^$|~]?=)\s*(.*)$/.exec(inner);
            if (!opMatch) {
                if (!el.hasAttribute(inner)) return false;
            } else {
                const attrName = opMatch[1]!;
                const op = opMatch[2]!;
                let expected = (opMatch[3] ?? "").trim();
                if (
                    (expected.startsWith('"') && expected.endsWith('"')) ||
                    (expected.startsWith("'") && expected.endsWith("'"))
                ) {
                    expected = expected.slice(1, -1);
                }
                const actual = el.getAttribute(attrName);
                if (actual === null) return false;
                if (op === "=" && actual !== expected) return false;
                if (op === "*=" && !actual.includes(expected)) return false;
                if (op === "^=" && !actual.startsWith(expected)) return false;
                if (op === "$=" && !actual.endsWith(expected)) return false;
                if (op === "~=" && !actual.split(/\s+/).includes(expected)) return false;
            }
            i = close + 1;
            continue;
        }
        if (ch === ":") {
            let j = i + 1;
            while (j < compound.length && /[a-zA-Z0-9_-]/.test(compound[j]!)) j++;
            const pseudo = compound.slice(i + 1, j);
            if (compound[j] === "(") {
                let depth = 1;
                let k = j + 1;
                while (k < compound.length && depth > 0) {
                    if (compound[k] === "(") depth++;
                    else if (compound[k] === ")") depth--;
                    k++;
                }
                const arg = compound.slice(j + 1, k - 1).trim();
                if (pseudo === "not" && matchesSelector(el, arg)) return false;
                i = k;
                continue;
            }
            if (pseudo === "checked" && !(el as any).checked) return false;
            if (pseudo === "disabled" && !(el as any).disabled) return false;
            if (pseudo === "first-child") {
                const parent = el.parentElement;
                if (!parent || parent.children[0] !== el) return false;
            }
            i = j;
            continue;
        }
        let j = i;
        while (j < compound.length && /[a-zA-Z0-9_:-]/.test(compound[j]!)) j++;
        if (j === i) return false;
        const tag = compound.slice(i, j).toLowerCase();
        if (el.tagName.toLowerCase() !== tag) return false;
        i = j;
    }
    return true;
}

function matchesSelectorPart(el: MockElement, part: string): boolean {
    const chain = parseCombinatorChain(part);
    if (chain.length === 0) return false;
    const last = chain[chain.length - 1]!;
    if (!matchesSingleCompound(el, last.compound)) return false;
    let cur: MockElement | null = el;
    for (let idx = chain.length - 2; idx >= 0; idx--) {
        const expectedComb = chain[idx + 1]!.comb;
        const targetCompound = chain[idx]!.compound;
        if (expectedComb === "child") {
            cur = cur?.parentElement ?? null;
            if (!cur || !matchesSingleCompound(cur, targetCompound)) return false;
        } else {
            let anc: MockElement | null = cur?.parentElement ?? null;
            while (anc && !matchesSingleCompound(anc, targetCompound)) {
                anc = anc.parentElement;
            }
            if (!anc) return false;
            cur = anc;
        }
    }
    return true;
}

export function matchesSelector(el: MockElement, selector: string): boolean {
    const parts = splitTopLevelCommas(selector);
    return parts.some((p) => matchesSelectorPart(el, p));
}

export class MockElement extends MockNode {
    readonly tagName: string;
    readonly localName: string;
    readonly _attributes = new Map<string, string>();
    readonly classList: MockClassList;
    readonly style: any;
    readonly dataset: Record<string, string>;
    value = "";
    checked = false;
    disabled = false;
    tabIndex = 0;
    scrollTop = 0;

    constructor(tagName: string, ownerDocument: MockDocument | null = null) {
        super(1, ownerDocument);
        this.localName = tagName.toLowerCase();
        this.tagName = tagName.toUpperCase();
        this.classList = new MockClassList(this);
        this.style = createStyleProxy(this);
        const self = this;
        this.dataset = new Proxy<Record<string, string>>(
            {},
            {
                get(_t, prop) {
                    if (typeof prop !== "string") return undefined;
                    return self.getAttribute(`data-${toKebabCase(prop)}`) ?? undefined;
                },
                set(_t, prop, value) {
                    if (typeof prop !== "string") return false;
                    self.setAttribute(`data-${toKebabCase(prop)}`, String(value ?? ""));
                    return true;
                },
                deleteProperty(_t, prop) {
                    if (typeof prop !== "string") return false;
                    self.removeAttribute(`data-${toKebabCase(prop)}`);
                    return true;
                },
                ownKeys() {
                    return Array.from(self._attributes.keys())
                        .filter((k) => k.startsWith("data-"))
                        .map((k) => toCamelCase(k.slice(5)));
                },
                getOwnPropertyDescriptor(_t, prop) {
                    if (typeof prop !== "string") return undefined;
                    const attr = `data-${toKebabCase(prop)}`;
                    const val = self.getAttribute(attr);
                    if (val === null) return undefined;
                    return {
                        enumerable: true,
                        configurable: true,
                        writable: true,
                        value: val,
                    };
                },
            },
        );
    }

    get children(): MockElement[] {
        return this.childNodes.filter((n): n is MockElement => n instanceof MockElement);
    }

    get firstElementChild(): MockElement | null {
        return this.children[0] ?? null;
    }

    get nextElementSibling(): MockElement | null {
        const parent = this.parentElement;
        if (!parent) return null;
        const siblings = parent.children;
        const idx = siblings.indexOf(this);
        return idx >= 0 && idx + 1 < siblings.length ? (siblings[idx + 1] ?? null) : null;
    }

    after(...nodes: Array<MockNode | string>): void {
        const parent = this.parentNode;
        if (!parent) return;
        const ref = parent.childNodes[parent.childNodes.indexOf(this) + 1] ?? null;
        for (const n of nodes) {
            const node = typeof n === "string" ? new MockTextNode(n, this.ownerDocument) : n;
            parent.insertBefore(node, ref);
        }
    }

    get offsetParent(): MockElement | null {
        return this.isConnected ? this.parentElement : null;
    }

    getClientRects(): Array<ReturnType<MockElement["getBoundingClientRect"]>> {
        return this.isConnected ? [this.getBoundingClientRect()] : [];
    }

    get id(): string {
        return this.getAttribute("id") ?? "";
    }

    set id(val: string) {
        this.setAttribute("id", val);
    }

    get className(): string {
        return this.getAttribute("class") ?? "";
    }

    set className(val: string) {
        if (val) this._rawSetAttribute("class", val);
        else this._rawRemoveAttribute("class");
    }

    get title(): string {
        return this.getAttribute("title") ?? "";
    }

    set title(val: string) {
        this.setAttribute("title", val);
    }

    get alt(): string {
        return this.getAttribute("alt") ?? "";
    }

    set alt(val: string) {
        this.setAttribute("alt", val);
    }

    get placeholder(): string {
        return this.getAttribute("placeholder") ?? "";
    }

    set placeholder(val: string) {
        this.setAttribute("placeholder", val);
    }

    get type(): string {
        return this.getAttribute("type") ?? "";
    }

    set type(val: string) {
        this.setAttribute("type", val);
    }

    get src(): string {
        return this.getAttribute("src") ?? "";
    }

    set src(val: string) {
        this.setAttribute("src", val);
    }

    get href(): string {
        return this.getAttribute("href") ?? "";
    }

    set href(val: string) {
        this.setAttribute("href", val);
    }

    get srcset(): string {
        return this.getAttribute("srcset") ?? "";
    }

    set srcset(val: string) {
        this.setAttribute("srcset", val);
    }

    get poster(): string {
        return this.getAttribute("poster") ?? "";
    }

    set poster(val: string) {
        this.setAttribute("poster", val);
    }

    get open(): boolean {
        return this.hasAttribute("open");
    }

    set open(val: boolean) {
        if (val) this.setAttribute("open", "");
        else this.removeAttribute("open");
    }

    get innerText(): string {
        return this.textContent;
    }

    set innerText(value: string) {
        this.textContent = value;
    }

    get innerHTML(): string {
        return this.childNodes.map(serializeChildHtml).join("");
    }

    set innerHTML(html: string) {
        for (const child of [...this.childNodes]) {
            child.parentNode = null;
        }
        this.childNodes = [];
        if (html) {
            parseSimpleHtmlInto(this, html, this.ownerDocument);
        }
    }

    _rawSetAttribute(name: string, value: string): void {
        this._attributes.set(name.toLowerCase(), String(value));
    }

    _rawRemoveAttribute(name: string): void {
        this._attributes.delete(name.toLowerCase());
    }

    setAttribute(name: string, value: string): void {
        const key = name.toLowerCase();
        const str = String(value);
        this._attributes.set(key, str);
        if (key === "style") {
            this.style._syncFromAttribute(str);
        } else if (key === "value") {
            this.value = str;
        } else if (key === "disabled") {
            this.disabled = true;
        } else if (key === "checked") {
            this.checked = true;
        }
    }

    getAttribute(name: string): string | null {
        const val = this._attributes.get(name.toLowerCase());
        return val === undefined ? null : val;
    }

    hasAttribute(name: string): boolean {
        return this._attributes.has(name.toLowerCase());
    }

    removeAttribute(name: string): void {
        const key = name.toLowerCase();
        this._attributes.delete(key);
        if (key === "style") {
            this.style._syncFromAttribute(null);
        } else if (key === "disabled") {
            this.disabled = false;
        } else if (key === "checked") {
            this.checked = false;
        }
    }

    matches(selector: string): boolean {
        return matchesSelector(this, selector);
    }

    closest(selector: string): MockElement | null {
        let cur: MockElement | null = this;
        while (cur) {
            if (cur.matches(selector)) return cur;
            cur = cur.parentElement;
        }
        return null;
    }

    querySelector(selector: string): MockElement | null {
        const queue: MockElement[] = [...this.children];
        while (queue.length > 0) {
            const node = queue.shift()!;
            if (node.matches(selector)) return node;
            if (node.children.length > 0) {
                queue.unshift(...node.children);
            }
        }
        return null;
    }

    querySelectorAll(selector: string): MockElement[] {
        const results: MockElement[] = [];
        const walk = (el: MockElement): void => {
            for (const child of el.children) {
                if (child.matches(selector)) {
                    results.push(child);
                }
                walk(child);
            }
        };
        walk(this);
        return results;
    }

    getBoundingClientRect(): {
        top: number;
        left: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
        x: number;
        y: number;
        toJSON: () => Record<string, never>;
    } {
        return {
            top: 0,
            left: 0,
            right: 120,
            bottom: 40,
            width: 120,
            height: 40,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        };
    }

    click(): void {
        if (this.disabled) return;
        const ev = new MockEvent("click", { bubbles: true, cancelable: true });
        this.dispatchEvent(ev);
    }

    focus(): void {}
    blur(): void {}
    select(): void {}
    scrollIntoView(): void {}
    setPointerCapture(): void {}
    releasePointerCapture(): void {}

    override dispatchEvent(event: MockEvent): boolean {
        if (!event.target) {
            event.target = this;
        }
        const path: Array<MockEventTarget> = [];
        let cur: MockNode | null = this;
        while (cur) {
            path.push(cur);
            cur = cur.parentNode;
        }
        if (this.ownerDocument && path[path.length - 1] !== this.ownerDocument) {
            path.push(this.ownerDocument);
        }
        const win = this.ownerDocument?._window;
        if (win) path.push(win);

        // Capture phase: root -> target
        for (let i = path.length - 1; i >= 0; i--) {
            if (event.propagationStopped) break;
            const node = path[i]!;
            event.currentTarget = node;
            node._invokeListeners(event, true);
        }

        // Target & bubble phase
        if (!event.propagationStopped) {
            for (let i = 0; i < path.length; i++) {
                if (i > 0 && !event.bubbles) break;
                if (event.propagationStopped) break;
                const node = path[i]!;
                event.currentTarget = node;
                node._invokeListeners(event, false);
            }
        }
        return !event.defaultPrevented;
    }
}

export class MockHTMLElement extends MockElement {}
export class MockHTMLImageElement extends MockHTMLElement {
    complete = true;
    naturalWidth = 100;
    decode(): Promise<void> {
        return Promise.resolve();
    }
}
export class MockHTMLVideoElement extends MockHTMLElement {}
export class MockHTMLSourceElement extends MockHTMLElement {}
export class MockHTMLStyleElement extends MockHTMLElement {}
export class MockHTMLIFrameElement extends MockHTMLElement {
    contentDocument: MockDocument | null = null;
}
export class MockHTMLAnchorElement extends MockHTMLElement {}
export class MockHTMLInputElement extends MockHTMLElement {}
export class MockHTMLTextAreaElement extends MockHTMLElement {}
export class MockHTMLSelectElement extends MockHTMLElement {
    get options(): MockElement[] {
        return this.querySelectorAll("option");
    }
}
export class MockHTMLButtonElement extends MockHTMLElement {}
export class MockSVGElement extends MockElement {}

export class MockDocument extends MockNode {
    readonly documentElement: MockHTMLElement;
    readonly head: MockHTMLElement;
    readonly body: MockHTMLElement;
    visibilityState = "visible";
    _window: MockWindow | null = null;

    constructor() {
        super(9, null);
        this.ownerDocument = this;
        this.documentElement = new MockHTMLElement("html", this);
        this.head = new MockHTMLElement("head", this);
        this.body = new MockHTMLElement("body", this);
        this.documentElement.appendChild(this.head);
        this.documentElement.appendChild(this.body);
        this.appendChild(this.documentElement);
    }

    createElement(tagName: string): MockElement {
        switch (tagName.toLowerCase()) {
            case "img":
                return new MockHTMLImageElement(tagName, this);
            case "video":
                return new MockHTMLVideoElement(tagName, this);
            case "source":
                return new MockHTMLSourceElement(tagName, this);
            case "style":
                return new MockHTMLStyleElement(tagName, this);
            case "iframe":
                return new MockHTMLIFrameElement(tagName, this);
            case "a":
                return new MockHTMLAnchorElement(tagName, this);
            case "input":
                return new MockHTMLInputElement(tagName, this);
            case "textarea":
                return new MockHTMLTextAreaElement(tagName, this);
            case "select":
                return new MockHTMLSelectElement(tagName, this);
            case "button":
                return new MockHTMLButtonElement(tagName, this);
            default:
                return new MockHTMLElement(tagName, this);
        }
    }

    createElementNS(ns: string, tagName: string): MockElement {
        if (ns.includes("svg")) {
            return new MockSVGElement(tagName, this);
        }
        return this.createElement(tagName);
    }

    createTextNode(text: string): MockTextNode {
        return new MockTextNode(text, this);
    }

    createDocumentFragment(): MockDocumentFragment {
        return new MockDocumentFragment(this);
    }

    getElementById(id: string): MockElement | null {
        return this.documentElement.querySelector(`#${id}`);
    }

    querySelector(selector: string): MockElement | null {
        return this.documentElement.querySelector(selector);
    }

    querySelectorAll(selector: string): MockElement[] {
        return this.documentElement.querySelectorAll(selector);
    }

    override dispatchEvent(event: MockEvent): boolean {
        if (!event.target) event.target = this;
        event.currentTarget = this;
        this._invokeListeners(event, true);
        if (!event.propagationStopped) {
            this._invokeListeners(event, false);
        }
        if (event.bubbles && !event.propagationStopped && this._window) {
            this._window.dispatchEvent(event);
        }
        return !event.defaultPrevented;
    }
}

export class MockWindow extends MockEventTarget {
    readonly document: MockDocument;
    location = {
        origin: "https://app.example",
        href: "https://app.example/",
        protocol: "https:",
        host: "app.example",
    };
    openedUrls: Array<{ url: string; target?: string; features?: string }> = [];
    confirmResult = true;
    confirmCalls: string[] = [];
    localStorageData = new Map<string, string>();
    localStorage: Storage;
    rafCallbacks = new Map<number, (ts: number) => void>();
    private nextRafId = 1;

    constructor(document: MockDocument) {
        super();
        this.document = document;
        document._window = this;
        const map = this.localStorageData;
        this.localStorage = {
            get length() {
                return map.size;
            },
            clear() {
                map.clear();
            },
            getItem(key: string) {
                return map.get(key) ?? null;
            },
            key(index: number) {
                return Array.from(map.keys())[index] ?? null;
            },
            removeItem(key: string) {
                map.delete(key);
            },
            setItem(key: string, value: string) {
                map.set(key, String(value));
            },
        };
    }

    open = (url: string, target?: string, features?: string): Record<string, unknown> => {
        this.openedUrls.push({ url, target, features });
        return {};
    };

    confirm = (message?: string): boolean => {
        this.confirmCalls.push(String(message ?? ""));
        return this.confirmResult;
    };

    getComputedStyle = (el: MockElement): { backgroundImage: string; getPropertyValue: (name: string) => string } => {
        const bg = el?.style?.backgroundImage || "none";
        return {
            backgroundImage: bg,
            getPropertyValue: (name: string) => el?.style?.getPropertyValue?.(name) ?? "",
        };
    };

    requestAnimationFrame = (cb: (ts: number) => void): number => {
        const id = this.nextRafId++;
        this.rafCallbacks.set(id, cb);
        return id;
    };

    cancelAnimationFrame = (id: number): void => {
        this.rafCallbacks.delete(id);
    };

    flushAnimationFrames(timestamp = 16): number {
        const entries = Array.from(this.rafCallbacks.entries());
        this.rafCallbacks.clear();
        for (const [, cb] of entries) {
            cb(timestamp);
        }
        return entries.length;
    }
}

export class MockMutationObserver {
    static instances: MockMutationObserver[] = [];

    readonly callback: (records: any[], observer: MockMutationObserver) => void;
    observed: Array<{ target: MockNode; options?: any }> = [];
    disconnected = false;

    constructor(callback: (records: any[], observer: MockMutationObserver) => void) {
        this.callback = callback;
        MockMutationObserver.instances.push(this);
    }

    observe(target: MockNode, options?: any): void {
        this.observed.push({ target, options });
    }

    disconnect(): void {
        this.disconnected = true;
    }

    takeRecords(): any[] {
        return [];
    }

    trigger(records: any[]): void {
        if (this.disconnected) return;
        this.callback(records, this);
    }
}

export class MockIntersectionObserver {
    static instances: MockIntersectionObserver[] = [];

    readonly callback: (entries: any[], observer: MockIntersectionObserver) => void;
    observedTargets = new Set<MockElement>();
    disconnected = false;

    constructor(callback: (entries: any[], observer: MockIntersectionObserver) => void) {
        this.callback = callback;
        MockIntersectionObserver.instances.push(this);
    }

    observe(target: MockElement): void {
        this.observedTargets.add(target);
    }

    unobserve(target: MockElement): void {
        this.observedTargets.delete(target);
    }

    disconnect(): void {
        this.disconnected = true;
        this.observedTargets.clear();
    }

    trigger(entries: Array<{ target: MockElement; isIntersecting: boolean }>): void {
        if (this.disconnected) return;
        this.callback(entries, this);
    }
}

export interface MockDomEnv {
    document: MockDocument;
    window: MockWindow;
    mutationObservers: typeof MockMutationObserver;
    intersectionObservers: typeof MockIntersectionObserver;
    restore: () => void;
}

export function installMockDom(): MockDomEnv {
    MockMutationObserver.instances = [];
    MockIntersectionObserver.instances = [];

    const document = new MockDocument();
    const window = new MockWindow(document);

    const g = globalThis as Record<string, unknown>;
    const globalsToPatch: Record<string, unknown> = {
        document,
        window,
        localStorage: window.localStorage,
        Node: MockNode,
        Element: MockElement,
        HTMLElement: MockHTMLElement,
        HTMLImageElement: MockHTMLImageElement,
        HTMLVideoElement: MockHTMLVideoElement,
        HTMLSourceElement: MockHTMLSourceElement,
        HTMLStyleElement: MockHTMLStyleElement,
        HTMLIFrameElement: MockHTMLIFrameElement,
        HTMLAnchorElement: MockHTMLAnchorElement,
        HTMLInputElement: MockHTMLInputElement,
        HTMLTextAreaElement: MockHTMLTextAreaElement,
        HTMLSelectElement: MockHTMLSelectElement,
        HTMLButtonElement: MockHTMLButtonElement,
        SVGElement: MockSVGElement,
        Event: MockEvent,
        CustomEvent: MockCustomEvent,
        KeyboardEvent: MockKeyboardEvent,
        MutationObserver: MockMutationObserver,
        IntersectionObserver: MockIntersectionObserver,
        requestAnimationFrame: window.requestAnimationFrame,
        cancelAnimationFrame: window.cancelAnimationFrame,
        getComputedStyle: window.getComputedStyle,
        confirm: window.confirm,
    };

    const previous = new Map<string, { hadOwn: boolean; value: unknown }>();
    for (const [key, value] of Object.entries(globalsToPatch)) {
        previous.set(key, {
            hadOwn: Object.prototype.hasOwnProperty.call(g, key),
            value: g[key],
        });
        g[key] = value;
    }

    return {
        document,
        window,
        mutationObservers: MockMutationObserver,
        intersectionObservers: MockIntersectionObserver,
        restore: () => {
            for (const [key, prev] of previous.entries()) {
                if (prev.hadOwn) {
                    g[key] = prev.value;
                } else {
                    delete g[key];
                }
            }
            MockMutationObserver.instances = [];
            MockIntersectionObserver.instances = [];
        },
    };
}

export interface MemoryStorage {
    files: Map<string, string>;
    calls: {
        exists: string[];
        read: string[];
        write: Array<{ path: string; bytes: number }>;
        move: Array<{ from: string; to: string }>;
        delete: string[];
        list: string[];
    };
    failNextExists: Error | null;
    failNextRead: Error | null;
    nullNextRead: boolean;
    failNextWrite: Error | null;
    failWriteOnPath: ((path: string) => Error | null) | null;
    failNextMove: Error | null;
    failMoveOnPath: ((from: string, to: string) => Error | null) | null;
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    delete(path: string): Promise<void>;
    move(from: string, to: string): Promise<void>;
    list(prefix?: string): Promise<string[]>;
}

export function createMemoryStorage(initialFiles?: Record<string, string>): MemoryStorage {
    const files = new Map<string, string>(Object.entries(initialFiles ?? {}));
    const storage: MemoryStorage = {
        files,
        calls: {
            exists: [],
            read: [],
            write: [],
            move: [],
            delete: [],
            list: [],
        },
        failNextExists: null,
        failNextRead: null,
        nullNextRead: false,
        failNextWrite: null,
        failWriteOnPath: null,
        failNextMove: null,
        failMoveOnPath: null,
        async exists(path: string): Promise<boolean> {
            storage.calls.exists.push(path);
            if (storage.failNextExists) {
                const err = storage.failNextExists;
                storage.failNextExists = null;
                throw err;
            }
            return files.has(path);
        },
        async read(path: string): Promise<string> {
            storage.calls.read.push(path);
            if (storage.failNextRead) {
                const err = storage.failNextRead;
                storage.failNextRead = null;
                throw err;
            }
            if (storage.nullNextRead) {
                storage.nullNextRead = false;
                return null as unknown as string;
            }
            const val = files.get(path);
            if (val === undefined) {
                throw new Error(`File not found: ${path}`);
            }
            return val;
        },
        async write(path: string, content: string): Promise<void> {
            storage.calls.write.push({ path, bytes: content.length });
            if (storage.failNextWrite) {
                const err = storage.failNextWrite;
                storage.failNextWrite = null;
                throw err;
            }
            const pathErr = storage.failWriteOnPath?.(path);
            if (pathErr) throw pathErr;
            files.set(path, content);
        },
        async delete(path: string): Promise<void> {
            storage.calls.delete.push(path);
            files.delete(path);
        },
        async move(from: string, to: string): Promise<void> {
            storage.calls.move.push({ from, to });
            if (storage.failNextMove) {
                const err = storage.failNextMove;
                storage.failNextMove = null;
                throw err;
            }
            const pathErr = storage.failMoveOnPath?.(from, to);
            if (pathErr) throw pathErr;
            const val = files.get(from);
            if (val === undefined) {
                throw new Error(`Move source not found: ${from}`);
            }
            files.set(to, val);
            files.delete(from);
        },
        async list(prefix?: string): Promise<string[]> {
            storage.calls.list.push(prefix ?? "");
            const all = Array.from(files.keys());
            return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
        },
    };
    return storage;
}
