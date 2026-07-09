(() => {
  const latestDesktopReleaseApi = "https://api.github.com/repos/MdSaifulIslamMSI/Aura/releases/latest";
  const releasesApi = "https://api.github.com/repos/MdSaifulIslamMSI/Aura/releases?per_page=24";
  const releasesPage = "https://github.com/MdSaifulIslamMSI/Aura/releases";
  const desktopStatus = document.querySelector('[data-release-status="desktop"]');
  const mobileStatus = document.querySelector('[data-release-status="mobile"]');
  const checksumStatus = document.querySelector("[data-release-checksum-status]");
  const checksumManifest = document.querySelector("[data-release-checksum-manifest]");
  const checksumDownload = document.querySelector("[data-release-checksum-download]");
  const desktopButtons = [
    ...document.querySelectorAll(
      '[data-release-asset][data-release-channel="desktop"], [data-release-asset]:not([data-release-channel])',
    ),
  ];
  const mobileButtons = [...document.querySelectorAll('[data-release-channel="mobile"]')];
  const checksumRecords = new Map();
  const sha256DigestPattern = /^sha256:[a-f0-9]{64}$/i;
  let checksumManifestUrl = "";
  let pendingReleaseChecks = 2;

  const getButtonName = (button) => button.querySelector("span")?.textContent.trim() || button.textContent.trim();
  const getReleaseLabel = (release) => release.name || release.tag_name || "release";
  const getAssetSha256 = (asset) =>
    typeof asset?.digest === "string" && sha256DigestPattern.test(asset.digest)
      ? asset.digest.slice("sha256:".length).toLowerCase()
      : null;

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
    button.removeAttribute("title");
    delete button.dataset.releaseChecksum;
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
    button.removeAttribute("title");
    delete button.dataset.releaseChecksum;
    setButtonStatus(button, "unknown", "Check releases");
    button.setAttribute(
      "aria-label",
      `${getButtonName(button)} could not be verified right now. Open GitHub Releases.`,
    );
  };

  const markUnavailable = (button) => {
    button.removeAttribute("href");
    button.removeAttribute("title");
    delete button.dataset.releaseChecksum;
    setButtonStatus(button, "unavailable", "Not published");
    button.setAttribute("aria-disabled", "true");
    button.setAttribute("tabindex", "-1");
    button.setAttribute(
      "aria-label",
      `${getButtonName(button)} is not published as a real release asset yet.`,
    );
  };

  const recordChecksum = (release, asset, sha256) => {
    const key = `${release.tag_name || getReleaseLabel(release)}:${asset.name}`;
    checksumRecords.set(key, {
      releaseTag: release.tag_name || getReleaseLabel(release),
      releaseName: getReleaseLabel(release),
      assetName: asset.name,
      downloadUrl: asset.browser_download_url,
      sha256,
    });
  };

  const renderChecksumManifest = () => {
    if (!checksumStatus || !checksumManifest) {
      return;
    }

    const records = [...checksumRecords.values()].sort((left, right) => {
      const releaseSort = left.releaseTag.localeCompare(right.releaseTag);
      return releaseSort || left.assetName.localeCompare(right.assetName);
    });

    if (!records.length && pendingReleaseChecks > 0) {
      checksumStatus.textContent = "Loading SHA-256 checksums";
      checksumManifest.textContent = "Checksums load from GitHub Releases.";
      if (checksumDownload) {
        checksumDownload.hidden = true;
      }
      return;
    }

    if (!records.length) {
      checksumStatus.textContent = "SHA-256 checksums unavailable";
      checksumManifest.textContent = "No release checksums could be verified here. Open GitHub Releases before installing.";
      if (checksumDownload) {
        checksumDownload.hidden = true;
      }
      return;
    }

    const lines = [
      "# Aura release SHA-256 checksums",
      "# Source: GitHub Releases asset digest metadata",
      "# Use these digests to verify the downloaded package file.",
    ];
    let currentRelease = "";

    for (const record of records) {
      if (record.releaseTag !== currentRelease) {
        currentRelease = record.releaseTag;
        lines.push("", `# ${record.releaseName} (${record.releaseTag})`);
      }

      lines.push(`${record.sha256}  ${record.assetName}`);
    }

    const manifestText = `${lines.join("\n")}\n`;

    checksumStatus.textContent = `SHA-256 checksums ready (${records.length})`;
    checksumManifest.textContent = manifestText;

    if (checksumDownload && "Blob" in window && "URL" in window) {
      if (checksumManifestUrl) {
        URL.revokeObjectURL(checksumManifestUrl);
      }

      checksumManifestUrl = URL.createObjectURL(new Blob([manifestText], { type: "text/plain" }));
      checksumDownload.href = checksumManifestUrl;
      checksumDownload.download = "aura-release-sha256s.txt";
      checksumDownload.hidden = false;
    }
  };

  const completeReleaseCheck = () => {
    pendingReleaseChecks = Math.max(0, pendingReleaseChecks - 1);
    renderChecksumManifest();
  };

  const markReady = (button, asset, release) => {
    const sha256 = getAssetSha256(asset);

    if (!asset?.browser_download_url || !sha256) {
      markUnknown(button);
      return false;
    }

    button.href = asset.browser_download_url;
    button.dataset.releaseChecksum = sha256;
    button.title = `${asset.name}\nSHA-256 ${sha256}`;
    setButtonStatus(button, "ready", `${button.dataset.releaseReadyLabel || "Ready"} · SHA-256`);
    button.setAttribute(
      "aria-label",
      `${getButtonName(button)} download. SHA-256 checksum ${sha256}.`,
    );
    button.removeAttribute("aria-disabled");
    button.removeAttribute("tabindex");
    recordChecksum(release, asset, sha256);
    return true;
  };

  const findReleaseAsset = (assets, button) => {
    const exactName = button.dataset.releaseAsset;

    if (exactName) {
      return assets.get(exactName) || null;
    }

    const prefix = button.dataset.releaseAssetPrefix || "";
    const suffix = button.dataset.releaseAssetSuffix || "";

    for (const [assetName, asset] of assets.entries()) {
      if (assetName.startsWith(prefix) && assetName.endsWith(suffix)) {
        return asset;
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
      const assets = new Map((release.assets || []).map((asset) => [asset.name, asset]));
      let availableCount = 0;
      let unavailableCount = 0;
      let unverifiedCount = 0;

      desktopButtons.forEach((button) => {
        const asset = findReleaseAsset(assets, button);

        if (!asset) {
          unavailableCount += 1;
          markUnavailable(button);
          return;
        }

        if (markReady(button, asset, release)) {
          availableCount += 1;
          return;
        }

        unverifiedCount += 1;
      });

      if (!desktopStatus) {
        return;
      }

      desktopStatus.textContent = availableCount
        ? `Desktop: ${getReleaseLabel(release)}. ${availableCount} checksummed download links ready${unavailableCount ? `, ${unavailableCount} unpublished` : ""}${unverifiedCount ? `, ${unverifiedCount} missing checksums` : ""}.`
        : "Desktop release found, but package files are not published yet.";
    })
    .catch(() => {
      desktopButtons.forEach(markUnknown);

      if (desktopStatus) {
        desktopStatus.textContent = "Desktop packages could not be verified here. Open releases for current availability.";
      }
    })
    .finally(completeReleaseCheck);

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

      const assets = new Map((mobileRelease.assets || []).map((asset) => [asset.name, asset]));
      let availableCount = 0;
      let unavailableCount = 0;
      let unverifiedCount = 0;

      mobileButtons.forEach((button) => {
        const asset = findReleaseAsset(assets, button);

        if (!asset) {
          unavailableCount += 1;
          markUnavailable(button);
          return;
        }

        if (markReady(button, asset, mobileRelease)) {
          availableCount += 1;
          return;
        }

        unverifiedCount += 1;
      });

      if (!mobileStatus) {
        return;
      }

      mobileStatus.textContent = availableCount
        ? `Mobile: ${getReleaseLabel(mobileRelease)}. ${availableCount} checksummed links ready${unavailableCount ? `, ${unavailableCount} unpublished` : ""}${unverifiedCount ? `, ${unverifiedCount} missing checksums` : ""}.`
        : "Mobile release found, but installable package files are not published yet.";
    })
    .catch(() => {
      mobileButtons.forEach(markUnknown);

      if (mobileStatus) {
        mobileStatus.textContent = "Mobile packages could not be verified here. Open releases for Android and iPhone.";
      }
    })
    .finally(completeReleaseCheck);
})();
