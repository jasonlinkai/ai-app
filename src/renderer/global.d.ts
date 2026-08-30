export {};

declare global {
  interface Window {
    ai: {
      chat: (message: string) => Promise<string>;
    };
  }
}
