import { mount } from "svelte";
import App from "./App.svelte";
import "./styles/theme.css";

const target = document.getElementById("app");

if (!target) {
  throw new Error("Не найден корневой элемент MarkNote");
}

mount(App, { target });
