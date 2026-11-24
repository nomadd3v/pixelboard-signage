// Vellum editor runtime — runs inside the edit-mode preview iframe.
// Makes text slots click-to-edit and reports changes to the parent shell,
// which runs them through the Guardian. The AI never touches this path.
(function () {
  'use strict';
  var originals = new Map();
  var revertTo = new Map(); // last accepted value per slot, for rejected edits

  function slots() {
    return document.querySelectorAll('.v-slot[data-v-slot]');
  }

  function commit(el) {
    var id = el.getAttribute('data-v-slot');
    var value = el.textContent;
    if (value === originals.get(id)) return;
    var previous = originals.get(id);
    originals.set(id, value);
    revertTo.set(id, previous);
    parent.postMessage({ type: 'vellum-edit', slotId: id, value: value }, '*');
  }

  function wire(el) {
    var id = el.getAttribute('data-v-slot');
    originals.set(id, el.textContent);
    el.setAttribute('title', 'Click to edit');
    el.addEventListener('click', function () {
      el.setAttribute('contenteditable', 'true');
      el.focus();
    });
    el.addEventListener('blur', function () {
      el.removeAttribute('contenteditable');
      commit(el);
    });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        el.blur();
      }
      if (e.key === 'Escape') {
        el.textContent = originals.get(id);
        el.blur();
      }
    });
  }

  function find(id) {
    return document.querySelector('.v-slot[data-v-slot="' + id + '"]');
  }

  // Messages from the shell: revert rejected slots, mirror a field edit onto the
  // board (live preview while typing), or highlight the slot a field points at.
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d) return;
    if (d.type === 'vellum-revert') {
      (d.slots || []).forEach(function (id) {
        var el = find(id);
        var prev = revertTo.has(id) ? revertTo.get(id) : originals.get(id);
        if (el && prev != null) { el.textContent = prev; originals.set(id, prev); }
      });
    } else if (d.type === 'vellum-set') {
      var el = find(d.slotId);
      if (el && el.getAttribute('contenteditable') !== 'true') {
        el.textContent = d.value;
        originals.set(d.slotId, d.value);
      }
    } else if (d.type === 'vellum-focus') {
      var cur = document.querySelectorAll('.v-slot.v-focus');
      for (var i = 0; i < cur.length; i++) cur[i].classList.remove('v-focus');
      var target = d.slotId && find(d.slotId);
      if (target) target.classList.add('v-focus');
    }
  });

  function init() {
    slots().forEach(wire);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
