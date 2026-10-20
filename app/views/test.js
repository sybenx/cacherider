// Testing the Android app: Google Play opens a new developer's app to everyone only after twelve testers have had it
// for fourteen days running, so this page asks riders on Android to be one. The testers are a Google Group's members
// (Play reads the group), so this site never holds anyone's email: a rider joins the group with their own Google
// account, opts in on Play, and installs. The group's address is the one setting; with none set, nothing invites.
import { D } from '../data.js';
import { html, icon } from '../ui.js';

export const TEST = {
  group: 'cacherider-testers',   // the Google Group the closed test's testers are: cacherider-testers@googlegroups.com
  optIn: 'https://play.google.com/apps/testing/com.cacherider.android',
  listing: 'https://play.google.com/store/apps/details?id=com.cacherider.android',
};
/** Whether to ask: an Android phone in a browser (not the app, not installed to its home screen), the group set, and
 *  not put away on this phone. */
export const testInvite = () => !!TEST.group && /Android/i.test(navigator.userAgent) && !matchMedia('(display-mode: standalone)').matches
  && !document.referrer.startsWith('android-app://') && (() => { try { return localStorage.getItem('cr-test-shut') !== '1'; } catch { return true; } })();
export const shutTestInvite = () => { try { localStorage.setItem('cr-test-shut', '1'); } catch { /* storage refused: back on the next page */ } };

/** The line at the top of the home page that asks. */
export function testLine() {
  if (!testInvite()) return '';
  return html`<div class="notice testline">${icon('install', 16)}<a href="#/test"><b>On Android?</b> Help Cache Rider get onto Google Play: test the app</a><button type="button" class="btn btn-ghost btn-icon" data-act="test-shut" aria-label="Hide">${icon('close', 18)}</button></div>`;
}

export function render() {
  const g = TEST.group, groupUrl = g ? `https://groups.google.com/g/${g}` : '';
  const mail = 'mailto:feedback@cacherider.com?subject=' + encodeURIComponent('Cache Rider Android test');
  const step = (n, t, s, href, label) => html`<li class="tstep"><span class="tn">${n}</span><div class="col"><span class="t">${t}</span><span class="s">${s}</span>${href ? html`<a class="btn btn-secondary" href="${href}" target="_blank" rel="noopener">${label}</a>` : ''}</div></li>`;
  const body = html`<div class="backbar"><a class="btn btn-ghost" href="#/" onclick="if(history.state&&history.state.prev){history.back();return false}">${icon('back', 22)}Stops</a></div>
    <div class="head"><h1>Test the Android app</h1></div>
    <div class="pad testpage">
      <p>Google Play lets a new app in only after twelve people have tested it for two weeks. If you have an Android phone, you can be one: it takes a couple of minutes, and the app is the same Cache Rider as this site.</p>
      <ol class="tsteps">
        ${step(1, 'Join the testers’ group', g ? `With the Google account on your phone. The group is ${g}@googlegroups.com.` : 'The group opens soon.', groupUrl, 'Join the group')}
        ${step(2, 'Become a tester', 'On Google Play, with the same account.', TEST.optIn, 'Become a tester')}
        ${step(3, 'Install Cache Rider', 'From Google Play. It can take a few minutes after step 2 to show.', TEST.listing, 'Open on Google Play')}
      </ol>
      <p>Then use it as you would for the next two weeks: a stop you wait at, a bus you’re catching. If something’s wrong or missing, say so. It’s what Google asks testers for, and it goes to the person who makes this, not to ${D.agency.brand}.</p>
      <a class="btn btn-secondary" href="${mail}">${icon('mail', 20)}Send feedback</a>
      <p class="muted" style="font-size:0.8125rem;margin-top:12px">Joining shares your Google account’s email with Google’s group and with Cache Rider’s maker, who manages the test on Google Play. This site itself keeps nothing. Leave the group any time, and you’re no longer a tester.</p>
    </div>`;
  return { title: 'Test the Android app', html: body.s };
}
