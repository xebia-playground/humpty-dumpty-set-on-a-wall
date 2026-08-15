export async function createAppSnapshot(page, targetUrl, options = {}) {
	const domSnapshot = await page.evaluate(() => {

		// --- CONSTANTS ---
		const MAX_VISIBLE_NODES = 200;
		const MAX_TEXT_LENGTH = 180;
		const INTERACTIVE_TAGS = new Set([
			'button', 'a', 'input', 'textarea', 'select',
			'option', 'label', 'summary', 'details'
		]);
		const ROLE_ALIASES = {
			button: 'button', link: 'link', textbox: 'textbox',
			searchbox: 'textbox', combobox: 'combobox', checkbox: 'checkbox',
			radio: 'radio', slider: 'slider', tab: 'tab', status: 'status', alert: 'alert'
		};

		// --- HELPER FUNCTIONS ---
		function normalizeText(value, maxLength = MAX_TEXT_LENGTH) {
			if (value == null) return '';
			return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
		}

		function isVisible(el) {
			if (!el || typeof el.getBoundingClientRect !== 'function') return false;
			const style = window.getComputedStyle(el);
			const rect = el.getBoundingClientRect();
			return (
				style.visibility !== 'hidden' &&
				style.display !== 'none' &&
				style.opacity !== '0' &&
				rect.width > 0 &&
				rect.height > 0
			);
		}

		function getTextContent(el) {
			return (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || el.value || '');
		}

		function getAccessibleName(el) {
			const ariaLabel = el.getAttribute('aria-label');
			if (ariaLabel) return normalizeText(ariaLabel);

			const labelledBy = el.getAttribute('aria-labelledby');
			if (labelledBy) {
				const ids = labelledBy.split(/\s+/).filter(Boolean);
				const text = ids
					.map((id) => document.getElementById(id))
					.filter(Boolean)
					.map((node) => getTextContent(node))
					.join(' ');
				if (text) return normalizeText(text);
			}

			if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
				const value = el.value;
				if (value) return normalizeText(value);
			}

			const placeholder = el.getAttribute('placeholder');
			if (placeholder) return normalizeText(placeholder);

			const alt = el.getAttribute('alt');
			if (alt) return normalizeText(alt);

			const text = normalizeText(getTextContent(el));
			if (text) return text;

			return '';
		}

		function inferRole(el) {
			const explicitRole = (el.getAttribute('role') || '').toLowerCase();
			if (explicitRole) return ROLE_ALIASES[explicitRole] || explicitRole;

			const tag = (el.tagName || '').toLowerCase();
			if (tag === 'button') return 'button';
			if (tag === 'a' && el.hasAttribute('href')) return 'link';
			if (tag === 'input') {
				const type = (el.type || 'text').toLowerCase();
				if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
				if (type === 'checkbox') return 'checkbox';
				if (type === 'radio') return 'radio';
				if (type === 'search') return 'textbox';
				return 'textbox';
			}
			if (tag === 'textarea') return 'textbox';
			if (tag === 'select') return 'combobox';
			if (tag === 'img') return 'img';
			if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) return 'heading';

			return '';
		}

		function getDepth(el) {
			let depth = 0; let current = el;
			while (current && current.parentElement) { depth += 1; current = current.parentElement; }
			return depth;
		}

		function getDomPath(el) {
			const path = []; let current = el;
			while (current && current.parentElement) {
				const parent = current.parentElement;
				const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
				const index = siblings.indexOf(current) + 1;
				path.unshift(`${current.tagName.toLowerCase()}:${index}`);
				current = parent;
			}
			return path.join(' > ') || 'root';
		}

		function buildNode(el) {
			const role = inferRole(el);
			const name = getAccessibleName(el);
			const text = normalizeText(getTextContent(el));
			const rect = el.getBoundingClientRect();
			const tagName = (el.tagName || '').toLowerCase();

			const isInteractive = role || INTERACTIVE_TAGS.has(tagName) || el.matches('button, a[href], input, textarea, select, [role], [aria-label]');
			if (!isInteractive) return null;

			return {
				tagName, role, name, text,
				id: el.id || '',
				type: el.getAttribute('type') || '',
				placeholder: el.getAttribute('placeholder') || '',
				href: el.getAttribute('href') || '',
				value: el.value || '',
				rect: {
					x: Math.round(rect.x),
					y: Math.round(rect.y),
					width: Math.round(rect.width),
					height: Math.round(rect.height),
				},
				path: getDomPath(el),
				depth: getDepth(el),
				parentTag: el.parentElement ? el.parentElement.tagName.toLowerCase() : '',
				parentRole: el.parentElement ? inferRole(el.parentElement) : '',
			};
		}

		function collectVisibleNodes() {
			const nodes = [];
			const seen = new Set();

			Array.from(document.querySelectorAll('*')).forEach((el) => {
				if (!isVisible(el)) return;
				const node = buildNode(el);
				if (!node) return;

				const key = `${node.tagName}:${node.role}:${node.name}:${node.path}`;
				if (seen.has(key)) return;

				seen.add(key);
				nodes.push(node);
			});

			return nodes
				.sort((a, b) => (a.rect.y + a.rect.x) - (b.rect.y + b.rect.x))
				.slice(0, MAX_VISIBLE_NODES);
		}

		// --- MAIN EVALUATION LOGIC ---
		const nodes = collectVisibleNodes();

		return {
			title: document.title || '',
			url: window.location.href,
			pathname: window.location.pathname,
			route: window.location.pathname + window.location.search,
			nodes,
			visibleNodeCount: nodes.length,
		};
	});

	let a11yTree = null;
	if (options.includeA11yTree !== false) {
		try {
			a11yTree = await page.accessibility.snapshot({ interestingOnly: true });
		} catch (error) {
			a11yTree = null;
		}
	}

	return {
		...domSnapshot,
		a11yTree,
		url: domSnapshot.url || targetUrl || page.url(),
	};
}

export function formatAppSnapshot(snapshot) {
	const lines = [
		`Title: ${snapshot.title || 'Not detected'}`,
		`URL: ${snapshot.url || 'Unknown'}`,
		`Route: ${snapshot.route || snapshot.pathname || 'Unknown'}`,
		'',
		'Visible interactive nodes:',
	];

	if (!snapshot.nodes || snapshot.nodes.length === 0) {
		lines.push('- No visible interactive nodes detected');
		return lines.join('\n');
	}

	for (const node of snapshot.nodes) {
		const label = node.name || node.text || node.placeholder || node.id || '(unnamed)';
		lines.push(
			`- [${node.role || node.tagName}] ${label} | rect=${node.rect.x},${node.rect.y} size=${node.rect.width}x${node.rect.height} | path=${node.path}`
		);
	}

	return lines.join('\n');
}