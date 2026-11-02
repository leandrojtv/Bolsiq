import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// No Node 25+ o global `localStorage` do proprio Node (indefinido sem
// --localstorage-file) sombreia o do jsdom. Em memoria, igual nas duas versoes.
if (typeof window.localStorage === "undefined") {
  const dados = new Map<string, string>();
  const armazenamento: Storage = {
    get length() {
      return dados.size;
    },
    clear: () => dados.clear(),
    getItem: (k) => dados.get(k) ?? null,
    key: (i) => [...dados.keys()][i] ?? null,
    removeItem: (k) => void dados.delete(k),
    setItem: (k, v) => void dados.set(k, String(v)),
  };
  Object.defineProperty(window, "localStorage", {
    value: armazenamento,
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: armazenamento,
    configurable: true,
  });
}

afterEach(() => cleanup());
