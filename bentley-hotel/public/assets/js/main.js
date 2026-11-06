/* The Bentley Hotel — small progressive enhancements. The site works without JS. */
(function () {
  "use strict";

  var doc = document.documentElement;
  doc.classList.add("js"); // also set inline in <head>; kept here as a fallback

  // Mobile navigation toggle
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  var header = document.querySelector(".site-header");
  if (toggle && nav && header) {
    var isOpen = function () { return toggle.getAttribute("aria-expanded") === "true"; };
    var setOpen = function (open) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      nav.classList.toggle("is-open", open);
      if (open) {
        nav.style.maxHeight = Math.max(160, window.innerHeight - header.getBoundingClientRect().bottom) + "px";
      } else {
        nav.style.maxHeight = "";
      }
    };
    toggle.addEventListener("click", function () { setOpen(!isOpen()); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen()) {
        setOpen(false);
        toggle.focus();
      }
    });
    // Close the menu when focus or a click moves outside the header
    document.addEventListener("focusin", function (e) {
      if (isOpen() && !header.contains(e.target)) setOpen(false);
    });
    document.addEventListener("click", function (e) {
      if (isOpen() && !header.contains(e.target)) setOpen(false);
    });
    var wideMq = window.matchMedia("(min-width: 1080px)");
    var onWide = function (mq) { if (mq.matches) setOpen(false); };
    if (wideMq.addEventListener) wideMq.addEventListener("change", onWide);
    else if (wideMq.addListener) wideMq.addListener(onWide);
  }

  // Reveal-on-scroll. Content is only hidden once the observer that reveals it exists.
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && reveals.length) {
    doc.classList.add("reveal-ready");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  }

  // Footer year
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  // Pre-select the enquiry type from links such as contact.html?enquiry=Wedding
  var typeSelect = document.getElementById("f-type");
  if (typeSelect && "URLSearchParams" in window) {
    var wanted = new URLSearchParams(window.location.search).get("enquiry");
    if (wanted) {
      Array.prototype.forEach.call(typeSelect.options, function (opt) {
        if (opt.value.toLowerCase() === wanted.toLowerCase()) typeSelect.value = opt.value;
      });
    }
  }

  // Gallery lightbox: links marked data-gallery open in a dialog; without JS they open the image.
  var galleryLinks = Array.prototype.slice.call(document.querySelectorAll("a[data-gallery]"));
  if (galleryLinks.length && window.HTMLDialogElement) {
    var dlg = document.createElement("dialog");
    dlg.className = "lightbox";
    dlg.setAttribute("aria-label", "Photo viewer");
    dlg.innerHTML =
      '<div class="lightbox__inner">' +
      '<button type="button" class="lightbox__close" data-lb-close aria-label="Close photo viewer">\u00d7</button>' +
      '<figure class="lightbox__figure"><img alt=""><figcaption class="lightbox__caption"></figcaption></figure>' +
      '<div class="lightbox__nav"><button type="button" class="btn btn--light" data-lb-prev>\u2190 Previous</button>' +
      '<span class="lightbox__count" aria-live="polite"></span>' +
      '<button type="button" class="btn btn--light" data-lb-next>Next \u2192</button></div></div>';
    document.body.appendChild(dlg);
    var lbImg = dlg.querySelector("img"), lbCap = dlg.querySelector(".lightbox__caption"), lbCount = dlg.querySelector(".lightbox__count");
    var current = 0, opener = null;
    var show = function (i) {
      current = (i + galleryLinks.length) % galleryLinks.length;
      var link = galleryLinks[current];
      var fig = link.closest("figure");
      var cap = fig && fig.querySelector("figcaption") ? fig.querySelector("figcaption").textContent.trim() : "";
      var alt = link.querySelector("img") ? link.querySelector("img").alt : "";
      lbImg.src = link.href;
      lbImg.alt = alt || cap;
      lbCap.textContent = cap;
      lbCount.textContent = "Photo " + (current + 1) + " of " + galleryLinks.length;
    };
    galleryLinks.forEach(function (link, i) {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        opener = link;
        show(i);
        dlg.showModal();
        dlg.querySelector("[data-lb-close]").focus();
      });
    });
    dlg.querySelector("[data-lb-close]").addEventListener("click", function () { dlg.close(); });
    dlg.querySelector("[data-lb-prev]").addEventListener("click", function () { show(current - 1); });
    dlg.querySelector("[data-lb-next]").addEventListener("click", function () { show(current + 1); });
    dlg.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { e.preventDefault(); show(current - 1); }
      if (e.key === "ArrowRight") { e.preventDefault(); show(current + 1); }
    });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () { lbImg.removeAttribute("src"); if (opener) opener.focus(); });
  }

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
        var input = form.querySelector('[name="' + key + '"]');
        var label = input && input.id ? form.querySelector('label[for="' + input.id + '"]') : null;
        lines.push((label ? label.textContent.replace(/\s*\(optional\)\s*/i, "").trim() : key) + ": " + value);
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
