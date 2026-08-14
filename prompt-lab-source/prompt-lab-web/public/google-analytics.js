(function initPromptLabGoogleAnalytics() {
  'use strict';

  var measurementId = 'G-NDPSYQES8R';
  var scriptId = 'promptlab-google-analytics';
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

  function readStoredConsent() {
    try {
      return window.localStorage.getItem('pl_telemetry_consent') === 'granted';
    } catch (_) {
      return false;
    }
  }

  var gtag = getGtag();
  window['ga-disable-' + measurementId] = true;
  gtag('consent', 'default', createConsentState(false));

  window.PromptLabGoogleAnalytics = { setConsent: setConsent };
  setConsent(readStoredConsent());
}());
