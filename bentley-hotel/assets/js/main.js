/* The Bentley Hotel — small progressive enhancements. The site works without JS. */
(function () {
  "use strict";

  var doc = document.documentElement;
  doc.classList.add("js");

  // Mobile navigation toggle
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    var setOpen = function (open) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      nav.classList.toggle("is-open", open);
    };
    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        setOpen(false);
        toggle.focus();
      }
    });
    window.matchMedia("(min-width: 1080px)").addEventListener("change", function (mq) {
      if (mq.matches) setOpen(false);
    });
  }

  // Reveal-on-scroll
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && reveals.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-visible"); });
  }

  // Footer year
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  // Enquiry forms: compose an email in the visitor's mail app (no server needed).
  document.querySelectorAll("form[data-mailto]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      var to = form.getAttribute("data-mailto");
      var data = new FormData(form);
      var subject = (data.get("enquiry_type") || "Enquiry") + " — website enquiry";
      var lines = [];
      data.forEach(function (value, key) {
        if (!value) return;
        var label = form.querySelector('[name="' + key + '"]');
        var field = label && label.id ? form.querySelector('label[for="' + label.id + '"]') : null;
        lines.push((field ? field.textContent.replace(/\s*\(optional\)\s*/i, "").trim() : key) + ": " + value);
      });
      window.location.href = "mailto:" + to +
        "?subject=" + encodeURIComponent(subject) +
        "&body=" + encodeURIComponent(lines.join("\n"));
      var status = form.querySelector("[data-form-status]");
      if (status) {
        status.textContent = "Your email app should now open with your enquiry ready to send. If nothing happens, please email " + to + " or call 01698 265588.";
      }
    });
  });
})();
