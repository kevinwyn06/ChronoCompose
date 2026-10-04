const { test, expect } = require('@playwright/test');
const { boot, task } = require('./_seed');

test.describe('keyboard-first task descriptions', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page, { seedOnce:true, tasks:[task('desc-1', 'Description task', { start:'0d', end:'+1d' })] });
    await page.locator('[data-task-id="desc-1"] [data-task-name]').click();
    /* UI revamp block 4: the description lives in the detail's Details disclosure, collapsed while empty. */
    await expect(page.locator('[data-pp-dialog="detail"]')).toBeVisible();
    await page.locator('[data-qa="detail-more"]').click();
    await expect(page.locator('[data-qa="detail-desc"]')).toBeVisible();
  });

  test('has no formatting line, keeps shortcuts, and autoformats a dash marker', async ({ page }) => {
    const editor = page.locator('.pp-rich[contenteditable][data-tid="desc-1"]').last();
    await expect(editor).toBeVisible();
    await expect(page.getByRole('button', { name:'Bold' })).toHaveCount(0);
    await expect(page.getByRole('button', { name:'Bullet list' })).toHaveCount(0);

    await editor.click();
    await page.keyboard.press('Control+b');
    await page.keyboard.type('bold');
    await page.keyboard.press('Control+b');
    await expect(editor.locator('b, strong')).toContainText('bold');

    await page.keyboard.press('Enter');
    await page.keyboard.type('- ');
    await page.keyboard.type('dash item');
    await expect(editor.locator('ul > li')).toContainText('dash item');
    await expect(editor.locator('ul > li')).not.toContainText('- ');
  });

  for (const [marker, list, item] of [['* ', 'ul', 'star item'], ['1. ', 'ol', 'number item']]) {
    test(`autoformats ${marker.trim()} at the start of an empty description`, async ({ page }) => {
      const editor = page.locator('.pp-rich[contenteditable][data-tid="desc-1"]').last();
      await editor.click();
      await page.keyboard.type(marker);
      await page.keyboard.type(item);
      await expect(editor.locator(`${list} > li`)).toContainText(item);
      await expect(editor.locator(`${list} > li`)).not.toContainText(marker);
    });
  }

  test('does not autoformat mid-line tokens or decimals', async ({ page }) => {
    const editor = page.locator('.pp-rich[contenteditable][data-tid="desc-1"]').last();
    await editor.click();
    await page.keyboard.type('ordinary - hyphen');
    await page.keyboard.press('Enter');
    await page.keyboard.type('multiply * value');
    await page.keyboard.press('Enter');
    await page.keyboard.type('3.14 decimal');
    await expect(editor.locator('ul, ol')).toHaveCount(0);
    await expect(editor).toContainText('ordinary - hyphen');
    await expect(editor).toContainText('multiply * value');
    await expect(editor).toContainText('3.14 decimal');
  });

  test('does not mistake a marker in a split inline node for the start of a visual line', async ({ page }) => {
    const editor = page.locator('.pp-rich[contenteditable][data-tid="desc-1"]').last();
    await editor.click();
    await page.keyboard.type('ordinary ');
    await page.keyboard.press('Control+b');
    await page.keyboard.type('bold');
    await page.keyboard.press('Control+b');
    await page.keyboard.type('- ');

    await expect(editor.locator('ul, ol')).toHaveCount(0);
    await expect(editor).toContainText('ordinary bold- ');
  });

  test('preserves native formatting, undo, sanitized paste, and stored HTML across reload', async ({ page, context }) => {
    const editor = page.locator('.pp-rich[contenteditable][data-tid="desc-1"]').last();
    await editor.click();
    for (const [shortcut, text] of [['Control+b', 'bold'], ['Control+i', 'italic'], ['Control+u', 'under']]) {
      await page.keyboard.press(shortcut);
      await page.keyboard.type(text);
      await page.keyboard.press(shortcut);
      await page.keyboard.type(' ');
    }
    await expect(editor.locator('b, strong')).toContainText('bold');
    await expect(editor.locator('i, em')).toContainText('italic');
    await expect(editor.locator('u')).toContainText('under');

    await page.keyboard.type('undo-me');
    await page.keyboard.press('Control+z');
    await expect(editor).not.toContainText('undo-me');

    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(async () => {
      const html = '<img src=x onerror="window.__pasted=1"><b onclick="window.__pasted=2">safe</b>'
        + '<script>window.__pasted=3</script><a href="javascript:alert(1)">link</a>';
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type:'text/html' }),
        'text/plain': new Blob(['safe link'], { type:'text/plain' }),
      })]);
    });
    await page.keyboard.press('Control+v');
    await expect(editor).toContainText('safe');
    await expect(editor).toContainText('link');

    await page.locator('[data-qa="detail-desc"] .pp-label').click(); /* UI revamp block 4: the row label blurs the editor */
    await expect.poll(() => page.evaluate(() => localStorage.getItem('pp-tasks'))).toContain('safe');
    await page.reload();
    await page.locator('[data-task-id="desc-1"] [data-task-name]').click();
    const restored = page.locator('.pp-rich[contenteditable][data-tid="desc-1"]').last();
    await expect(restored).toContainText('bold');
    await expect(restored).toContainText('italic');
    await expect(restored).toContainText('under');
    await expect(restored).toContainText('safe');
    await expect(restored).toContainText('link');
    await expect(restored.locator('img, script')).toHaveCount(0);
    await expect(restored.locator('[onclick], [onerror], a[href^="javascript:"]')).toHaveCount(0);
  });
});
