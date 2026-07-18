const MAX_ITEMS_PER_GROUP = 20;
const MAX_TEXT_LENGTH = 120;

export async function createAppSnapshot(page, targetUrl) {
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
			productHints: collect('[data-testid*="product" i],[class*="product" i],[aria-label*="product" i]', (element) => element.textContent || element.getAttribute('aria-label')),
		};
	}, {
		maxItemsPerGroup: MAX_ITEMS_PER_GROUP,
		maxTextLength: MAX_TEXT_LENGTH,
	});

	return {
		...snapshot,
		url: page.url() || targetUrl,
	};
}

export function formatAppSnapshot(snapshot) {
	const lines = [
		`URL: ${snapshot.url}`,
		`Title: ${snapshot.title || 'Not detected'}`,
	];

	appendGroup(lines, 'Headings', snapshot.headings);
	appendGroup(lines, 'Buttons', snapshot.buttons);
	appendGroup(lines, 'Links', snapshot.links);
	appendGroup(lines, 'Textboxes', snapshot.textboxes);
	appendGroup(lines, 'Product hints', snapshot.productHints);

	return lines.join('\n');
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