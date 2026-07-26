const MAX_ITEMS_PER_GROUP = 20;
const MAX_TEXT_LENGTH = 120;
const MAX_TREE_DEPTH = 6;

const SNAPSHOT_GROUPS = [
	'headings',
	'buttons',
	'links',
	'textboxes',
	'canvases',
	'statusText',
	'contentHints',
];

const ROLE_TO_GROUP = {
	heading: 'headings',
	button: 'buttons',
	link: 'links',
	textbox: 'textboxes',
	searchbox: 'textboxes',
	img: 'canvases',
	image: 'canvases',
	status: 'statusText',
	alert: 'statusText',
};

export async function createAppSnapshot(page, targetUrl, options = {}) {
	const snapshot = await page.evaluate(({ maxItemsPerGroup, maxTextLength }) => {
		const cleanText = (value) => (value || '').replace(/\s+/g, ' ').trim().slice(0, maxTextLength);
		const isVisible = (element) => {
			const style = window.getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
		};
		const collect = (selector, mapper) => Array.from(document.querySelectorAll(selector))
			.filter(isVisible)
			.map(mapper)
			.map(cleanText)
			.filter(Boolean)
			.slice(0, maxItemsPerGroup);

		return {
			title: cleanText(document.title),
			headings: collect('h1,h2,h3,h4,h5,h6,[role="heading"]', (element) => element.textContent),
			buttons: collect('button,[role="button"],input[type="button"],input[type="submit"]', (element) => element.innerText || element.value || element.getAttribute('aria-label')),
			links: collect('a[href],[role="link"]', (element) => element.innerText || element.getAttribute('aria-label') || element.getAttribute('href')),
			textboxes: collect('input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="password"],textarea,[role="textbox"]', (element) => element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.name || element.id),
			canvases: collect('canvas,[role="img"],[aria-label*="canvas" i],[aria-label*="game" i]', (element) => element.getAttribute('aria-label') || element.textContent || element.id),
			statusText: collect('[role="status"],[aria-live],[data-testid*="score" i],[data-testid*="hud" i],[class*="score" i],[class*="hud" i]', (element) => element.textContent || element.getAttribute('aria-label')),
			contentHints: collect('[data-testid],[aria-label]', (element) => element.textContent || element.getAttribute('aria-label') || element.getAttribute('data-testid')),
		};
	}, {
		maxItemsPerGroup: MAX_ITEMS_PER_GROUP,
		maxTextLength: MAX_TEXT_LENGTH,
	});

	const useAccessibilityTree = options.useAccessibilityTree !== false;
	if (useAccessibilityTree) {
		try {
			const ariaSnapshot = await page.ariaSnapshot({
				mode: 'ai',
				depth: options.maxDepth || MAX_TREE_DEPTH,
			});
			const treeSnapshot = createEmptySnapshot();
			flattenAriaSnapshotText(ariaSnapshot, treeSnapshot, {
				maxItemsPerGroup: MAX_ITEMS_PER_GROUP,
				maxTextLength: MAX_TEXT_LENGTH,
			});

			mergeSnapshotGroup(treeSnapshot, 'canvases', snapshot.canvases);
			mergeSnapshotGroup(treeSnapshot, 'statusText', snapshot.statusText);
			mergeSnapshotGroup(treeSnapshot, 'contentHints', snapshot.contentHints);
			treeSnapshot.title = treeSnapshot.title || snapshot.title;

			return {
				...treeSnapshot,
				url: page.url() || targetUrl,
			};
		} catch (error) {
			console.warn(`Accessibility snapshot unavailable for ${page.url() || targetUrl}. Falling back to DOM snapshot. ${error.message}`);
		}
	}

	return {
		...snapshot,
		url: page.url() || targetUrl,
	};
}

function flattenAriaSnapshotText(ariaSnapshot, snapshot, { maxItemsPerGroup, maxTextLength }) {
	if (!ariaSnapshot) {
		return;
	}

	const seenValues = {
		headings: new Set(),
		buttons: new Set(),
		links: new Set(),
		textboxes: new Set(),
		canvases: new Set(),
		statusText: new Set(),
		contentHints: new Set(),
	};

	for (const rawLine of String(ariaSnapshot).split('\n')) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}

		const roleMatch = line.match(/^-\s*([a-zA-Z][\w-]*)\b/);
		if (!roleMatch) {
			continue;
		}

		const role = normalizeRole(roleMatch[1]);
		const quotedNameMatch = line.match(/"([^"]+)"/);
		const bracketMatch = line.match(/\[([^\]]+)\]/g);
		const bracketText = bracketMatch ? bracketMatch.join(' ').replace(/\[|\]/g, '') : '';
		const combinedText = [quotedNameMatch?.[1], bracketText]
			.filter(Boolean)
			.join(' ');
		const name = normalizeText(combinedText, maxTextLength);

		if (!snapshot.title && role === 'heading' && name) {
			snapshot.title = name;
		}

		const group = ROLE_TO_GROUP[role];
		if (group && name) {
			pushUnique(snapshot[group], seenValues[group], name, maxItemsPerGroup);
		}

		if (role && name) {
			pushUnique(snapshot.contentHints, seenValues.contentHints, `${role}: ${name}`, maxItemsPerGroup);
		}
	}
}

function mergeSnapshotGroup(snapshot, group, values) {
	const seen = new Set(snapshot[group]);
	for (const value of values || []) {
		if (!seen.has(value) && snapshot[group].length < MAX_ITEMS_PER_GROUP) {
			snapshot[group].push(value);
			seen.add(value);
		}
	}
}

function pushUnique(values, seenSet, value, maxItemsPerGroup) {
	if (!value || seenSet.has(value) || values.length >= maxItemsPerGroup) {
		return;
	}

	values.push(value);
	seenSet.add(value);
}

function normalizeRole(value) {
	return String(value || '').toLowerCase().trim();
}

function normalizeText(value, maxTextLength = MAX_TEXT_LENGTH) {
	return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxTextLength);
}

function createEmptySnapshot() {
	return {
		title: '',
		headings: [],
		buttons: [],
		links: [],
		textboxes: [],
		canvases: [],
		statusText: [],
		contentHints: [],
	};
}

export function formatAppSnapshot(snapshot) {
	if (Array.isArray(snapshot.routes)) {
		return [
			`Base URL: ${snapshot.url}`,
			`Routes inspected: ${snapshot.routes.length}`,
			'',
			...snapshot.routes.map(formatSingleAppSnapshot),
		].join('\n\n---\n\n');
	}

	return formatSingleAppSnapshot(snapshot);
}

function formatSingleAppSnapshot(snapshot) {
	const lines = [
		`Route: ${getRoutePath(snapshot.url)}`,
		`URL: ${snapshot.url}`,
		`Title: ${snapshot.title || 'Not detected'}`,
	];

	appendGroup(lines, 'Headings', snapshot.headings);
	appendGroup(lines, 'Buttons', snapshot.buttons);
	appendGroup(lines, 'Links', snapshot.links);
	appendGroup(lines, 'Textboxes', snapshot.textboxes);
	appendGroup(lines, 'Canvases', snapshot.canvases);
	appendGroup(lines, 'Status text', snapshot.statusText);
	appendGroup(lines, 'Content hints', snapshot.contentHints);

	return lines.join('\n');
}

function getRoutePath(url) {
	try {
		const parsedUrl = new URL(url);
		return `${parsedUrl.pathname}${parsedUrl.search}` || '/';
	} catch {
		return url || 'Unknown';
	}
}

function appendGroup(lines, label, values = []) {
	lines.push(`${label}:`);
	if (values.length === 0) {
		lines.push('- None detected');
		return;
	}

	for (const value of values) {
		lines.push(`- ${value}`);
	}
}