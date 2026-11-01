import React, { useState } from 'react';
import { View } from 'react-native';
import mobileAds, {
  AdsConsent, AdEventType, BannerAd, BannerAdSize, RewardedAd, RewardedAdEventType,
} from 'react-native-google-mobile-ads';
import { BANNER_UNIT, REWARDED_UNIT } from './config';

let started = null;

/** Ask for GDPR/US-state consent where required, then start the SDK. */
export function initAds() {
  if (!started) {
    started = (async () => {
      try { await AdsConsent.gatherConsent(); } catch (e) { console.warn('consent', e?.message); }
      try { await mobileAds().initialize(); } catch (e) { console.warn('ads init', e?.message); }
    })();
  }
  return started;
}

/** Adaptive banner shown to free-tier users. */
export function Banner() {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <View style={{ alignItems: 'center' }}>
      <BannerAd unitId={BANNER_UNIT} size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER} onAdFailedToLoad={() => setFailed(true)} />
    </View>
  );
}

/**
 * Load and show a rewarded ad. Server-side verification tells our backend
 * which user (userId) and which server (customData) to extend, so the reward
 * can't be faked from the client.
 * Resolves true if the user earned the reward, false if they closed early.
 */
export async function showRewarded({ userId, serverId }) {
  await initAds();
  return new Promise((resolve, reject) => {
    const ad = RewardedAd.createForAdRequest(REWARDED_UNIT, {
      serverSideVerificationOptions: { userId: String(userId), customData: String(serverId) },
    });
    let earned = false;
    const subs = [];
    const done = (fn) => { subs.forEach((u) => u()); fn(); };
    subs.push(ad.addAdEventListener(RewardedAdEventType.LOADED, () => ad.show().catch((e) => done(() => reject(e)))));
    subs.push(ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => { earned = true; }));
    subs.push(ad.addAdEventListener(AdEventType.CLOSED, () => done(() => resolve(earned))));
    subs.push(ad.addAdEventListener(AdEventType.ERROR, (e) => done(() => reject(new Error(e?.message || 'No ad available right now, try again in a minute.')))));
    ad.load();
  });
}
