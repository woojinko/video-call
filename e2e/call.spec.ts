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
