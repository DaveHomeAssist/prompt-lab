import { chromium, expect, test } from '@playwright/test';
import path from 'node:path';

for (const width of [375,1440,3840]) test(`Chat conversation, privacy, cancellation and handoff at ${width}px`, async ({}, testInfo) => {
  const extension=path.resolve('dist');
  const context=await chromium.launchPersistentContext('', {channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  try {
    const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page=await context.newPage();
    await page.setViewportSize({width,height:width===375?812:width===3840?1080:900});
    await page.addInitScript(() => {
      localStorage.setItem('pl_telemetry_consent','denied');
      const original=chrome.runtime.sendMessage.bind(chrome.runtime);
      window.__chatRequests=[];window.__chatAborts=[];
      chrome.runtime.sendMessage=(message,callback)=>{
        if(message?.type==='MODEL_REQUEST'){window.__chatRequests.push({message,callback});return;}
        if(message?.type==='MODEL_ABORT'){window.__chatAborts.push(message);callback?.({ok:true});return;}
        return original(message,callback);
      };
    });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`);
    const editor=page.getByTestId('prompt-input');
    await editor.fill('Original prompt to preserve.');
    await page.getByRole('button',{name:'Chat',exact:true}).click();
    const panel=page.getByRole('complementary',{name:'Chat beside Write'});
    const input=panel.getByRole('textbox',{name:'Message',exact:true});
    expect(await page.evaluate(()=>window.__chatRequests.length)).toBe(0);
    await expect(panel.getByRole('checkbox',{name:'Include current prompt'})).not.toBeChecked();
    await input.fill('First question');
    await input.press('Control+Enter');
    await expect(panel.getByRole('button',{name:'Cancel request'})).toBeVisible();
    expect(await page.evaluate(()=>window.__chatRequests.map(row=>row.message.payload.messages))).toEqual([[{role:'user',content:'First question'}]]);
    expect(await page.evaluate(()=>JSON.stringify(window.__chatRequests[0].message.payload))).not.toContain('Original prompt to preserve.');
    await page.evaluate(()=>window.__chatRequests[0].callback({data:{content:[{text:'First answer\n\n```js\nconsole.log("hello")\n```'}],provider:'fixture',model:'selected-model'}}));
    await expect(panel.getByText('First answer',{exact:true})).toBeVisible();
    await expect(panel.getByRole('button',{name:'Copy code',exact:true})).toBeVisible();
    await panel.getByRole('button',{name:'Close side panel'}).click();
    await page.getByRole('button',{name:'Chat',exact:true}).click();
    await expect(panel.getByText('First answer',{exact:true})).toBeVisible();
    await input.fill('Second question');await panel.getByRole('button',{name:'Send message'}).click();
    expect(await page.evaluate(()=>window.__chatRequests[1].message.payload.messages.map(row=>row.role))).toEqual(['user','assistant','user']);
    await panel.getByRole('button',{name:'Cancel request'}).click();
    expect(await page.evaluate(()=>window.__chatAborts.length)).toBe(1);
    await page.evaluate(()=>window.__chatRequests[1].callback({data:{content:[{text:'Late unwanted reply'}]}}));
    await expect(panel.getByText('Late unwanted reply')).toHaveCount(0);
    await expect(input).toHaveValue('Second question');
    expect(await page.evaluate(()=>window.__chatRequests.length)).toBe(2);
    await panel.getByRole('checkbox',{name:'Include current prompt'}).check();
    await expect(panel.getByText('First answer',{exact:true})).toHaveCount(0);
    await input.fill('Contact fixture@example.com');await panel.getByRole('button',{name:'Send message'}).click();
    const pii=page.getByRole('dialog',{name:'Sensitive Data Detected'});
    await expect(pii).toBeVisible();
    expect(await page.evaluate(()=>window.__chatRequests.map(row=>row.message.payload.messages))).toHaveLength(2);
    await pii.getByRole('button',{name:'Redact & Send'}).click();
    expect(await page.evaluate(()=>JSON.stringify(window.__chatRequests[2].message.payload))).not.toContain('fixture@example.com');
    expect(await page.evaluate(()=>window.__chatRequests[2].message.payload.system)).toContain('Original prompt to preserve.');
    await page.evaluate(()=>window.__chatRequests[2].callback({data:{content:[{text:'A useful new prompt.'}],provider:'fixture',model:'selected-model'}}));
    await expect(panel.getByText('A useful new prompt.',{exact:true})).toBeVisible();
    for(const theme of ['light','dark']){
      if(await page.locator('.pl-app-shell').getAttribute('data-theme')!==theme){
        const more=page.getByRole('button',{name:'More actions',exact:true});
        if(await more.isVisible()){await more.click();await page.getByRole('button',{name:theme==='light'?'Light mode':'Dark mode',exact:true}).click();}
        else await page.getByRole('button',{name:`Switch to ${theme} mode`,exact:true}).click();
      }
      expect(await page.evaluate(()=>({x:document.documentElement.scrollWidth>document.documentElement.clientWidth,y:document.documentElement.scrollHeight>document.documentElement.clientHeight}))).toEqual({x:false,y:false});
      await expect(input).toBeInViewport();
      await expect(panel.getByRole('button',{name:'Send message'})).toBeInViewport();
      await page.screenshot({path:testInfo.outputPath(`chat-${width}-${theme}.png`),animations:'disabled'});
    }
    await panel.getByRole('button',{name:'Use as new prompt'}).click();
    // On phones close the floating chat panel before checking the editor.
    if(width<1100)await panel.getByRole('button',{name:'Close side panel'}).click();
    await expect(editor).toHaveValue('A useful new prompt.');
    expect(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('pl2-draft-reset-recovery-v1')).editor.raw)).toBe('Original prompt to preserve.');
    await page.getByRole('button',{name:'Undo reset',exact:true}).click();
    await expect(editor).toHaveValue('Original prompt to preserve.');
    await page.reload();
    const toggle=page.getByRole('button',{name:'Chat',exact:true});
    if(await toggle.getAttribute('aria-pressed')!=='true')await toggle.click();
    await expect(panel.getByText('A useful new prompt.',{exact:true})).toHaveCount(0);
    expect(await page.evaluate(()=>window.__chatRequests.length)).toBe(0);
  } finally {await context.close();}
});
