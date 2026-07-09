(() => {
  const latestDesktopReleaseApi = "https://api.github.com/repos/MdSaifulIslamMSI/Aura/releases/latest";
  const releasesApi = "https://api.github.com/repos/MdSaifulIslamMSI/Aura/releases?per_page=24";
  const releasesPage = "https://github.com/MdSaifulIslamMSI/Aura/releases";
  const desktopStatus = document.querySelector('[data-release-status="desktop"]');
  const mobileStatus = document.querySelector('[data-release-status="mobile"]');
  const desktopButtons = [
    ...document.querySelectorAll(
      '[data-release-asset][data-release-channel="desktop"], [data-release-asset]:not([data-release-channel])',
    ),
  ];
  const mobileButtons = [...document.querySelectorAll('[data-release-channel="mobile"]')];

  const getButtonName = (button) => button.querySelector("span")?.textContent.trim() || button.textContent.trim();

  const setButtonStatus = (button, state, label) => {
    button.dataset.downloadState = state;
    const status = button.querySelector("small");

    if (status) {
      status.textContent = label;
    }
  };

  const markChecking = (button) => {
    button.href = releasesPage;
    button.removeAttribute("aria-disabled");
    button.removeAttribute("tabindex");
    setButtonStatus(button, "checking", "Checking asset");
    button.setAttribute(
      "aria-label",
      `${getButtonName(button)} is being checked against GitHub Releases.`,
    );
  };

  const markUnknown = (button) => {
    button.href = releasesPage;
    button.removeAttribute("aria-disabled");
    button.removeAttribute("tabindex");
    setButtonStatus(button, "unknown", "Check releases");
    button.setAttribute(
      "aria-label",
      `${getButtonName(button)} could not be verified right now. Open GitHub Releases.`,
    );
  };

  const markUnavailable = (button) => {
    button.removeAttribute("href");
    setButtonStatus(button, "unavailable", "Not published");
    button.setAttribute("aria-disabled", "true");
    button.setAttribute("tabindex", "-1");
    button.setAttribute(
      "aria-label",
      `${getButtonName(button)} is not published as a real release asset yet.`,
    );
  };

  const markReady = (button, downloadUrl) => {
    button.href = downloadUrl;
    setButtonStatus(button, "ready", button.dataset.releaseReadyLabel || "Ready");
    button.removeAttribute("aria-label");
    button.removeAttribute("aria-disabled");
    button.removeAttribute("tabindex");
  };

  const findDownloadUrl = (assets, button) => {
    const exactName = button.dataset.releaseAsset;

    if (exactName) {
      return assets.get(exactName) || null;
    }

    const prefix = button.dataset.releaseAssetPrefix || "";
    const suffix = button.dataset.releaseAssetSuffix || "";

    for (const [assetName, downloadUrl] of assets.entries()) {
      if (assetName.startsWith(prefix) && assetName.endsWith(suffix)) {
        return downloadUrl;
      }
    }

    return null;
  };

  [...desktopButtons, ...mobileButtons].forEach(markChecking);

  fetch(latestDesktopReleaseApi, { headers: { Accept: "application/vnd.github+json" } })
    .then((response) => {
      if (!response.ok) {
        throw new Error("Latest release is unavailable");
      }

      return response.json();
    })
    .then((release) => {
      const assets = new Map((release.assets || []).map((asset) => [asset.name, asset.browser_download_url]));
      let availableCount = 0;
      let unavailableCount = 0;

      desktopButtons.forEach((button) => {
        const downloadUrl = findDownloadUrl(assets, button);

        if (!downloadUrl) {
          unavailableCount += 1;
          markUnavailable(button);
          return;
        }

        availableCount += 1;
        markReady(button, downloadUrl);
      });

      if (!desktopStatus) {
        return;
      }

      desktopStatus.textContent = availableCount
        ? `Desktop: ${release.name || release.tag_name}. ${availableCount} download links ready${unavailableCount ? `, ${unavailableCount} unpublished.` : "."}`
        : "Desktop release found, but package files are not published yet.";
    })
    .catch(() => {
      desktopButtons.forEach(markUnknown);

      if (desktopStatus) {
        desktopStatus.textContent = "Desktop packages could not be verified here. Open releases for current availability.";
      }
    });

  fetch(releasesApi, { headers: { Accept: "application/vnd.github+json" } })
    .then((response) => {
      if (!response.ok) {
        throw new Error("Mobile releases are unavailable");
      }

      return response.json();
    })
    .then((releases) => {
      const mobileRelease = (releases || []).find(
        (release) =>
          !release.draft &&
          !release.prerelease &&
          typeof release.tag_name === "string" &&
          release.tag_name.startsWith("mobile-v"),
      );

      if (!mobileRelease) {
        throw new Error("No mobile release found");
      }

      const assets = new Map((mobileRelease.assets || []).map((asset) => [asset.name, asset.browser_download_url]));
      let availableCount = 0;
      let unavailableCount = 0;

      mobileButtons.forEach((button) => {
        const downloadUrl = findDownloadUrl(assets, button);

        if (!downloadUrl) {
          unavailableCount += 1;
          markUnavailable(button);
          return;
        }

        availableCount += 1;
        markReady(button, downloadUrl);
      });

      if (!mobileStatus) {
        return;
      }

      mobileStatus.textContent = availableCount
        ? `Mobile: ${mobileRelease.name || mobileRelease.tag_name}. ${availableCount} links ready${unavailableCount ? `, ${unavailableCount} unpublished.` : "."}`
        : "Mobile release found, but installable package files are not published yet.";
    })
    .catch(() => {
      mobileButtons.forEach(markUnknown);

      if (mobileStatus) {
        mobileStatus.textContent = "Mobile packages could not be verified here. Open releases for Android and iPhone.";
      }
    });
})();
