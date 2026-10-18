import { HIDE_AMOUNTS_STORAGE_KEY } from "@/lib/constants";

/** Inline <head> script: applies the stored "hide amounts" preference before first paint. */
export const hideAmountsScript = `try{if(localStorage.getItem(${JSON.stringify(
  HIDE_AMOUNTS_STORAGE_KEY,
)})==="1")document.documentElement.setAttribute("data-hide-amounts","")}catch(e){}`;
