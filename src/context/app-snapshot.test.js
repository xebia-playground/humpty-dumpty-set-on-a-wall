import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { formatAppSnapshot } from './app-snapshot.js';

test('formats multi-route snapshots for Copilot context', () => {
	const formattedSnapshot = formatAppSnapshot({
		url: 'http://app-under-test:3000/',
		routes: [
			{
				url: 'http://app-under-test:3000/',
				title: 'Home',
				headings: ['Welcome'],
				buttons: ['Start'],
				links: ['Products'],
				textboxes: [],
				canvases: [],
				statusText: [],
				contentHints: [],
			},
			{
				url: 'http://app-under-test:3000/game?level=1',
				title: 'Game',
				headings: ['Skyline Plumber Run'],
				buttons: ['Restart'],
				links: [],
				textboxes: [],
				canvases: ['Playable side scrolling platform game'],
				statusText: ['Score 0 Coins 0 Lives 3'],
				contentHints: ['Find the red flag'],
			},
		],
	});

	assert.match(formattedSnapshot, /Routes inspected: 2/);
	assert.match(formattedSnapshot, /Route: \/$/m);
	assert.match(formattedSnapshot, /Route: \/game\?level=1/);
	assert.match(formattedSnapshot, /Canvases:\n- Playable side scrolling platform game/);
	assert.match(formattedSnapshot, /Status text:\n- Score 0 Coins 0 Lives 3/);
});

test('formats accessibility-driven snapshot groups for Copilot context', () => {
	const formattedSnapshot = formatAppSnapshot({
		url: 'http://app-under-test:3000/',
		routes: [
			{
				url: 'http://app-under-test:3000/tracking',
				title: 'Live Ride Tracking',
				headings: ['Trip updates'],
				buttons: ['Cancel ride'],
				links: ['Support'],
				textboxes: ['Pickup location'],
				canvases: ['City map canvas'],
				statusText: ['Driver arriving in 3 min'],
				contentHints: ['status: Driver arriving in 3 min', 'button: Cancel ride'],
			},
		],
	});

	assert.match(formattedSnapshot, /Route: \/tracking/);
	assert.match(formattedSnapshot, /Buttons:\n- Cancel ride/);
	assert.match(formattedSnapshot, /Status text:\n- Driver arriving in 3 min/);
	assert.match(formattedSnapshot, /Content hints:\n- status: Driver arriving in 3 min/);
});