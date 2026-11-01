import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { TestIds } from 'react-native-google-mobile-ads';

const extra = Constants.expoConfig?.extra ?? {};

// Android emulator reaches your computer at 10.0.2.2, iOS simulator at localhost.
export const API_URL = (extra.apiUrl || (Platform.OS === 'android' ? 'http://10.0.2.2:8080' : 'http://localhost:8080')).replace(/\/$/, '');

const ads = extra.ads || {};
const pick = (android, ios, test) => (__DEV__ ? test : (Platform.OS === 'ios' ? ios : android) || test);

// Google's test ad units are used in development and whenever a real id isn't configured.
export const BANNER_UNIT = pick(ads.androidBanner, ads.iosBanner, TestIds.ADAPTIVE_BANNER);
export const REWARDED_UNIT = pick(ads.androidRewarded, ads.iosRewarded, TestIds.REWARDED);

export const colors = {
  bg: '#0b0f17', panel: '#121826', panel2: '#182033', line: '#253049',
  text: '#e6ebf5', muted: '#8b97b1', accent: '#4ade80', accent2: '#38bdf8',
  warn: '#fbbf24', danger: '#f87171', free: '#c4b5fd',
};
