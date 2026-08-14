(function initPromptLabGoogleAnalytics() {
  'use strict';

  var measurementId = 'G-NDPSYQES8R';
  var scriptId = 'promptlab-google-analytics';
  var consentPromptId = 'promptlab-analytics-consent';
  var consentPromptStyleId = consentPromptId + '-style';
  var consentKey = 'pl_telemetry_consent';
  var configured = false;

  function createConsentState(value) {
    var consent = value ? 'granted' : 'denied';
    return {
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: consent,
    };
  }

  function getGtag() {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtag() {
      window.dataLayer.push(arguments);
    };
    return window.gtag;
  }

  function removeGoogleAnalyticsCookies() {
    var names = document.cookie.split(';').map(function getName(cookie) {
      return cookie.trim().split('=')[0];
    }).filter(function isGoogleAnalyticsCookie(name) {
      return name === '_ga' || name.indexOf('_ga_') === 0;
    });
    var hostParts = window.location.hostname.split('.');
    var domains = [''];

    for (var index = 0; index < hostParts.length - 1; index += 1) {
      domains.push(hostParts.slice(index).join('.'));
      domains.push('.' + hostParts.slice(index).join('.'));
    }

    names.forEach(function removeCookie(name) {
      domains.forEach(function removeForDomain(domain) {
        document.cookie = name + '=; Max-Age=0; Path=/' + (domain ? '; Domain=' + domain : '');
      });
    });
  }

  function loadGoogleTag() {
    if (document.getElementById(scriptId)) return;

    var script = document.createElement('script');
    script.id = scriptId;
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(measurementId);
    document.head.appendChild(script);
  }

  function setConsent(granted) {
    var gtag = getGtag();
    var analyticsGranted = granted === true;

    window['ga-disable-' + measurementId] = !analyticsGranted;
    gtag('consent', 'update', createConsentState(analyticsGranted));

    if (!analyticsGranted) {
      removeGoogleAnalyticsCookies();
      return;
    }

    loadGoogleTag();
    if (!configured) {
      configured = true;
      gtag('js', new Date());
      gtag('config', measurementId);
    }
  }

  function readConsentChoice() {
    try {
      var value = window.localStorage.getItem(consentKey);
      return value === 'granted' || value === 'denied' ? value : null;
    } catch (_) {
      return null;
    }
  }

  function saveConsentChoice(value) {
    try {
      window.localStorage.setItem(consentKey, value);
    } catch (_) {
      // The choice applies to this page even if private browsing blocks storage.
    }
  }

  function isHostedApp() {
    return /^\/app\/?$/.test(window.location.pathname);
  }

  function removeConsentPrompt() {
    document.getElementById(consentPromptId)?.remove();
    document.getElementById(consentPromptStyleId)?.remove();
  }

  function showConsentPrompt() {
    if (isHostedApp() || readConsentChoice() !== null || document.getElementById(consentPromptId)) return;

    function renderPrompt() {
      if (!document.body || document.getElementById(consentPromptId)) return;

      var style = document.createElement('style');
      style.id = consentPromptStyleId;
      style.textContent = [
        '#' + consentPromptId + '{position:fixed;right:20px;bottom:20px;z-index:10000;max-width:min(420px,calc(100vw - 32px));padding:16px;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:#12121a;color:#f5f3ed;box-shadow:0 16px 48px rgba(0,0,0,.34);font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
        '#' + consentPromptId + ' p{margin:0 0 12px}',
        '#' + consentPromptId + ' a{color:#f3b19f;text-decoration:underline;text-underline-offset:2px}',
        '#' + consentPromptId + ' div{display:flex;flex-wrap:wrap;gap:8px}',
        '#' + consentPromptId + ' button{min-height:36px;border-radius:8px;padding:7px 11px;font:inherit;font-weight:700;cursor:pointer}',
        '#' + consentPromptId + ' button:focus-visible,#' + consentPromptId + ' a:focus-visible{outline:2px solid #f3b19f;outline-offset:3px}',
        '#' + consentPromptId + ' [data-action="allow"]{border:1px solid #cc4524;background:#cc4524;color:#fff}',
        '#' + consentPromptId + ' [data-action="deny"]{border:1px solid rgba(255,255,255,.28);background:transparent;color:inherit}',
        '@media (max-width:480px){#' + consentPromptId + '{right:16px;bottom:16px}}',
      ].join('');

      var prompt = document.createElement('aside');
      prompt.id = consentPromptId;
      prompt.setAttribute('role', 'region');
      prompt.setAttribute('aria-label', 'Analytics preference');

      var message = document.createElement('p');
      message.append('Help improve Prompt Lab with lightweight usage analytics. ');
      var privacyLink = document.createElement('a');
      privacyLink.href = '/privacy.html';
      privacyLink.textContent = 'Privacy policy';
      message.append(privacyLink);

      var actions = document.createElement('div');
      var allow = document.createElement('button');
      allow.type = 'button';
      allow.dataset.action = 'allow';
      allow.textContent = 'Allow analytics';
      allow.addEventListener('click', function allowAnalytics() {
        saveConsentChoice('granted');
        setConsent(true);
        removeConsentPrompt();
      });

      var deny = document.createElement('button');
      deny.type = 'button';
      deny.dataset.action = 'deny';
      deny.textContent = 'No thanks';
      deny.addEventListener('click', function denyAnalytics() {
        saveConsentChoice('denied');
        setConsent(false);
        removeConsentPrompt();
      });

      actions.append(allow, deny);
      prompt.append(message, actions);
      document.head.append(style);
      document.body.append(prompt);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderPrompt, { once: true });
      return;
    }
    renderPrompt();
  }

  function readStoredConsent() {
    return readConsentChoice() === 'granted';
  }

  var gtag = getGtag();
  window['ga-disable-' + measurementId] = true;
  gtag('consent', 'default', createConsentState(false));

  window.PromptLabGoogleAnalytics = { setConsent: setConsent };
  setConsent(readStoredConsent());
  showConsentPrompt();
}());
