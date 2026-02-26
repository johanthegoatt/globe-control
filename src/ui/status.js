export function createStatus(pillEl, messageEl) {
  return {
    set(state, message) {
      pillEl.dataset.state = state;
      pillEl.textContent = state.charAt(0).toUpperCase() + state.slice(1);
      messageEl.textContent = message;
    }
  };
}