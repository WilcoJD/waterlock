// Types for Expo's public env vars. EXPO_PUBLIC_* values are inlined at bundle time when accessed
// literally as `process.env.EXPO_PUBLIC_NAME`. These declarations merge with @types/node / expo/types
// when those are present, and stand alone when they are not.
declare namespace NodeJS {
  interface ProcessEnv {
    /** Base URL of the RipVault API, e.g. "http://192.168.1.20:4000" or "https://api.ripvault.app". */
    readonly EXPO_PUBLIC_API_URL?: string;
  }
  interface Process {
    env: ProcessEnv;
  }
}
declare var process: NodeJS.Process;
