(() => {
  const platformTools = document.querySelector("[data-platform-tools]");
  const platformGrid = document.querySelector("[data-platform-grid]");
  const platformCards = [...document.querySelectorAll("[data-platform-card]")];
  const platformSearch = document.querySelector("[data-platform-search]");
  const platformFilters = [...document.querySelectorAll("[data-platform-filter]")];
  const platformResultCount = document.querySelector("[data-platform-result-count]");
  const platformEmpty = document.querySelector("[data-platform-empty]");
  let activeFilter = "all";

  const normalize = (value) =>
    value
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const filterLabels = {
    all: "all platform lanes",
    desktop: "desktop lanes",
    mobile: "mobile lanes",
    browser: "browser and PWA lanes",
    linux: "Linux family lanes",
    embedded: "embedded and companion lanes",
    specialized: "specialized and legacy lanes",
  };

  const renderPlatformMatrix = () => {
    if (!platformGrid || !platformCards.length) {
      return;
    }

    const query = normalize(platformSearch?.value || "");
    let visibleCount = 0;

    platformCards.forEach((card) => {
      const matchesFilter = activeFilter === "all" || card.dataset.platformCategory === activeFilter;
      const matchesSearch = !query || normalize(card.textContent).includes(query);
      const isVisible = matchesFilter && matchesSearch;

      card.hidden = !isVisible;
      card.dataset.platformVisible = String(isVisible);
      visibleCount += Number(isVisible);
    });

    platformFilters.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.platformFilter === activeFilter));
    });

    if (platformResultCount) {
      const scope = filterLabels[activeFilter] || "platform lanes";
      platformResultCount.textContent = query
        ? `${visibleCount} of ${platformCards.length} platform lanes match “${platformSearch.value.trim()}” in ${scope}.`
        : activeFilter === "all"
          ? `All ${platformCards.length} platform lanes shown.`
          : `${visibleCount} ${scope} shown.`;
    }

    if (platformEmpty) {
      platformEmpty.hidden = visibleCount !== 0;
    }

    platformGrid.dataset.resultState = visibleCount ? "ready" : "empty";
  };

  if (platformTools && platformGrid && platformCards.length) {
    platformTools.hidden = false;

    platformFilters.forEach((button) => {
      button.addEventListener("click", () => {
        activeFilter = button.dataset.platformFilter || "all";
        renderPlatformMatrix();
      });
    });

    platformSearch?.addEventListener("input", renderPlatformMatrix);
    renderPlatformMatrix();
  }

  const userAgent = navigator.userAgent || "";
  const reportedPlatform = navigator.userAgentData?.platform || navigator.platform || "";
  const touchPoints = navigator.maxTouchPoints || 0;
  const isIPadDesktopMode = /Mac/i.test(reportedPlatform) && touchPoints > 1;
  const deviceLanes = [
    {
      matches: /iPad|iPhone|iPod/i.test(userAgent) || isIPadDesktopMode,
      name: "iPhone or iPad",
      target: "#platform-ios",
      category: "mobile",
      note: "Review Apple signing, simulator, and PWA guidance before installing.",
    },
    {
      matches: /Android/i.test(userAgent),
      name: "Android",
      target: "#platform-android",
      category: "mobile",
      note: "Review debug APK and Play release availability before installing.",
    },
    {
      matches: /CrOS/i.test(userAgent),
      name: "ChromeOS",
      target: "#platform-chromeos",
      category: "browser",
      note: "The hosted Aura PWA is the supported ChromeOS lane.",
    },
    {
      matches: /Win/i.test(reportedPlatform) || /Windows/i.test(userAgent),
      name: "Windows",
      target: "#platform-windows",
      category: "desktop",
      note: "Installer and portable options are listed with the unsigned-build warning.",
    },
    {
      matches: /Mac/i.test(reportedPlatform) || /Macintosh/i.test(userAgent),
      name: "macOS",
      target: "#platform-macos",
      category: "desktop",
      note: "Apple Silicon, Intel, DMG, and ZIP options are listed together.",
    },
    {
      matches: /Linux/i.test(reportedPlatform) || /Linux/i.test(userAgent),
      name: "Linux",
      target: "#platform-linux",
      category: "linux",
      note: "AppImage, deb, RPM, tar.gz, x64, and ARM64 options are listed together.",
    },
  ];
  const detectedLane = deviceLanes.find((lane) => lane.matches);

  if (!detectedLane) {
    return;
  }

  const matchingCard = document.querySelector(detectedLane.target);
  const deviceLinks = [document.querySelector("[data-device-cta]"), document.querySelector("[data-device-guide-link]")].filter(Boolean);
  const heroLabel = document.querySelector("[data-device-cta-label]");
  const heroNote = document.querySelector("[data-device-cta-note]");
  const guideTitle = document.querySelector("[data-device-guide-title]");
  const guideCopy = document.querySelector("[data-device-guide-copy]");
  const guideLabel = document.querySelector("[data-device-guide-link-label]");

  matchingCard?.setAttribute("data-device-match", "true");
  deviceLinks.forEach((link) => {
    link.href = detectedLane.target;
    link.addEventListener("click", () => {
      activeFilter = detectedLane.category;
      if (platformSearch) {
        platformSearch.value = "";
      }
      renderPlatformMatrix();
    });
  });

  if (heroLabel) {
    heroLabel.textContent = `Install options for ${detectedLane.name}`;
  }
  if (heroNote) {
    heroNote.textContent = "Detected locally in this browser";
  }
  if (guideTitle) {
    guideTitle.textContent = `${detectedLane.name} lane detected`;
  }
  if (guideCopy) {
    guideCopy.textContent = detectedLane.note;
  }
  if (guideLabel) {
    guideLabel.textContent = `Open ${detectedLane.name} guidance`;
  }
})();
