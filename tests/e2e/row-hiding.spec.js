const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

const fixture = () => ({
  seedOnce:true,
  tasks:[
    task('rh-a','Alpha',{start:'0d',end:'+1d'}),
    task('rh-b','Bravo',{start:'0d',end:'+1d'}),
    task('rh-c','Charlie',{start:'0d',end:'+1d'}),
    task('rh-d','Delta',{start:'0d',end:'+1d'}),
  ],
});

async function trustedRightClick(page, id) {
  const box = await page.locator(`[data-task-id="${id}"]`).first().boundingBox();
  await page.mouse.move(box.x + 80, box.y + box.height / 2);
  await page.mouse.down({button:'right'});
  await page.mouse.up({button:'right'});
}

test('trusted right-click hides a row, reload keeps it hidden, and Show restores its exact slot', async ({ page }) => {
  await bootSurface(page, {view:'gantt'}, fixture());
  await trustedRightClick(page, 'rh-b');
  await page.locator('[data-hide-row-action]').click();

  const marker = page.locator('[data-hidden-row-marker]');
  await expect(page.locator('[data-task-id="rh-b"]')).toHaveCount(0);
  await expect(marker).toHaveAttribute('data-hidden-count','1');
  await expect(marker).toContainText('1 hidden row');
  await expect(marker.getByRole('button',{name:'Show'})).toBeVisible();
  await expect(page.locator('[data-gantt-hidden-marker]')).toHaveCount(1);

  await page.reload();
  await expect(page.locator('[data-task-id="rh-b"]')).toHaveCount(0);
  await expect(marker).toHaveAttribute('data-hidden-count','1');
  await marker.getByRole('button',{name:'Show'}).click();
  await expect(page.locator('[data-task-id="rh-b"]')).toBeVisible();
  const order = await page.locator('[data-task-id]').evaluateAll(els => els.map(e=>e.getAttribute('data-task-id')));
  expect(order.slice(0,4)).toEqual(['rh-a','rh-b','rh-c','rh-d']);
});

test('consecutive hidden rows share one truthful marker and all remain reachable', async ({ page }) => {
  await bootSurface(page, {view:'gantt'}, fixture());
  for (const id of ['rh-b','rh-c']) {
    await trustedRightClick(page,id);
    await page.locator('[data-hide-row-action]').click();
  }
  const marker = page.locator('[data-hidden-row-marker]');
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveAttribute('data-hidden-count','2');
  await expect(marker).toContainText('2 hidden rows');
  await marker.getByRole('button',{name:'Show'}).click();
  await expect(page.locator('[data-task-id="rh-b"]')).toBeVisible();
  await expect(page.locator('[data-task-id="rh-c"]')).toBeVisible();
});
