import { test, expect, type Page } from '@playwright/test';

async function joinRoom(page: Page, room: string) {
  await page.goto(`/?room=${room}`);
  await page.getByRole('button', { name: 'Join' }).click();
}

test('two peers connect and receive each other’s audio + video', async ({ context }) => {
  const room = `e2e-${Date.now()}`;
  const alice = await context.newPage();
  const bob = await context.newPage();

  await joinRoom(alice, room);
  await expect(alice.getByText('Waiting for the other person')).toBeVisible();

  await joinRoom(bob, room);
  await expect(alice.locator('.status-connected')).toBeVisible({ timeout: 15_000 });
  await expect(bob.locator('.status-connected')).toBeVisible({ timeout: 15_000 });

  // Remote <video> has both tracks live and is actually decoding frames.
  const remoteTracks = await bob.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('.remote video');
    const stream = video?.srcObject as MediaStream | null;
    return stream?.getTracks().map((t) => `${t.kind}:${t.readyState}`).sort() ?? [];
  });
  expect(remoteTracks).toEqual(['audio:live', 'video:live']);
  await expect
    .poll(() => bob.evaluate(() => document.querySelector<HTMLVideoElement>('.remote video')?.videoWidth ?? 0))
    .toBeGreaterThan(0);
});

test('the stats overlay shows live numbers from getStats()', async ({ context }) => {
  const room = `stats-${Date.now()}`;
  const alice = await context.newPage();
  const bob = await context.newPage();

  await joinRoom(alice, room);
  await joinRoom(bob, room);
  await expect(bob.locator('.status-connected')).toBeVisible({ timeout: 15_000 });

  await bob.getByRole('button', { name: 'Stats' }).click();
  const overlay = bob.getByRole('complementary', { name: 'Connection stats' });
  // Both pages run on one machine, so ICE should pick a direct host or srflx route.
  await expect(overlay.locator('[data-stat="route"]')).toHaveText(/^(host|srflx|prflx) → (host|srflx|prflx)/);
  await expect(overlay.locator('[data-stat="rtt"]')).toHaveText(/^\d+ ms$/);
  // Bitrates need two samples, so they appear about a second after the overlay opens.
  await expect(overlay.locator('[data-stat="video-in"]')).toHaveText(/^[1-9]\d* kbps · \d+×\d+/);
  await expect(overlay.locator('[data-stat="video-out"]')).toHaveText(/^[1-9]\d* kbps · \d+×\d+/);

  await bob.getByRole('button', { name: 'Stats' }).click();
  await expect(overlay).toBeHidden();
});

test('a third person is turned away, and hang-up returns the other peer to waiting', async ({ context }) => {
  const room = `full-${Date.now()}`;
  const [a, b, c] = await Promise.all([context.newPage(), context.newPage(), context.newPage()]);

  await joinRoom(a, room);
  await joinRoom(b, room);
  await expect(a.locator('.status-connected')).toBeVisible({ timeout: 15_000 });

  await joinRoom(c, room);
  await expect(c.getByText('already has two people')).toBeVisible();

  await b.getByRole('button', { name: 'Hang up' }).click();
  await expect(a.getByText('Waiting for the other person')).toBeVisible();
});

test('a broken /ice-config ends the call with a visible error instead of silently skipping TURN', async ({ context }) => {
  // Simulates a proxy answering the config path with an HTML error page.
  await context.route('**/ice-config', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Bad gateway</html>' }),
  );
  const room = `badcfg-${Date.now()}`;
  const alice = await context.newPage();
  const bob = await context.newPage();

  await joinRoom(alice, room);
  await expect(alice.getByText('Waiting for the other person')).toBeVisible();
  await joinRoom(bob, room);

  // Alice is the offerer, so she needs the config first; she fails and leaves, and Bob goes back to waiting.
  await expect(alice.getByText('Could not load connection settings from the server.')).toBeVisible();
  await expect(bob.getByText('Waiting for the other person')).toBeVisible();
});
