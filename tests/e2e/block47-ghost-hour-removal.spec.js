const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

async function bootGantt(page) {
  await bootSurface(page, { view:'gantt' }, {
    tasks:[
      task('dated','Dated task',{start:'0d',end:'+2d',pct:45}),
      task('start-only','Start only',{start:'0d',end:null,pct:45}),
      task('due-only','Due only',{start:null,end:'+2d',pct:45}),
      task('dateless','Dateless task',{start:null,end:null,pct:45})
    ]
  });
  await page.locator('[data-gantt-task-id]').first().waitFor({state:'attached',timeout:15000});
}

test('half-dated bars are solid, dateless rows are empty, and wide zoom never becomes Hour', async ({page}) => {
  await bootGantt(page);

  const titles=await page.locator('[title]').evaluateAll(els=>els.map(el=>el.getAttribute('title')||''));
  expect(titles.some(t=>t.startsWith('Dateless task')), 'fully dateless task draws no bar').toBe(false);

  for(const name of ['Start only','Due only']){
    const body=page.locator(`[title^="${name}"]`).first();
    await expect(body, name+' bar renders').toBeVisible();
    const paint=await body.evaluate(el=>{
      const s=getComputedStyle(el);
      return {image:s.backgroundImage,left:s.borderLeftStyle,right:s.borderRightStyle};
    });
    expect(paint.image, name+' has no gradient').toBe('none');
    expect(paint.left, name+' has no dotted left edge').not.toBe('dotted');
    expect(paint.right, name+' has no dotted right edge').not.toBe('dotted');
  }

  const datedBar=page.locator('[title^="Dated task"]').first();
  const beforeZoom=await datedBar.boundingBox();

  const row=page.locator('[data-gantt-task-id]').first();
  const scroller=await row.evaluateHandle(el=>{
    let n=el.parentElement;
    while(n && !/auto|scroll/.test(getComputedStyle(n).overflow)) n=n.parentElement;
    return n;
  });
  const box=await scroller.asElement().boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+40);
  await page.keyboard.down('Control');
  for(let i=0;i<12;i++) await page.mouse.wheel(0,-240);
  await page.keyboard.up('Control');
  await page.waitForTimeout(300);

  await expect(page.getByText('Hour',{exact:true}), 'the retired fourth zoom label never appears').toHaveCount(0);
  const afterZoom=await datedBar.boundingBox();
  expect(afterZoom.width, 'Ctrl-wheel still reaches a visibly wider day scale').toBeGreaterThan(beforeZoom.width*2);
});
