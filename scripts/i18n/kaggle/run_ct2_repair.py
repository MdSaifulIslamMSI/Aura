#!/usr/bin/env python3
"""
Kaggle Cloud GPU NLLB-200 AST-Masked Localization Repair Worker.

Runs completely inside a Kaggle notebook/script container (Nvidia Tesla T4 / P100)
with zero local laptop/host CPU execution. Supports both offline Kaggle dataset mounts
and online Hugging Face Hub snapshot downloads.
"""

import ctypes
import glob
import json
import os
import re
import subprocess
import sys
import time

DEFAULT_HF_REPO = os.environ.get(
    "AURA_NLLB_HF_REPO",
    "JustFrederik/nllb-200-distilled-600M-ct2-int8",
)
SENTINEL_RE = re.compile(r"\{v(\d+)\}")
LOOSE_CURLY_RE = re.compile(r"\{\s*[vV]\s*(\d+)\s*\}")
LOOSE_UNDERSCORE_RE = re.compile(r"_\s*(\d+)\s*_")
UNK_CHAR_RE = re.compile(r"[\u2047\ufffd\u2219]|\?{2,}")
STRICT_VERBATIM_RE = re.compile(
    r"^(?:https?://\S+|mailto:\S+|[^\s@]+@[^\s@]+\.[^\s@]+|npm\s+run\s+[a-z0-9:_-]+|[Nn]/[Aa]|MM\s*/\s*YY|Gmail|Gatus|Uptime Kuma|Aura Marketplace Desktop|Aura Marketplace \{\{?version\}\}?|\{\{?phoneCode\}\}?\s*98X+)$"
)

DISAMBIGUATED_MT_SOURCES = {
    "Tune market": "Adjust market settings",
    "Req:": "Request:",
    "Failed to update avatar.": "Could not update profile picture.",
    "Payment state is controlled by backend validations and idempotent operations.": "Payment status is managed by server verification and repeat-safe checks.",
    "Checkout reliability improvements with backend-authoritative quotes.": "Checkout reliability improvements with server-verified price quotes.",
}

SUPPRESS_KW = {}

NATIVE_SCRIPT_EXEMPT_SOURCE_WORDS = {
    "qwerty", "asdf", "oauth", "webhook", "resend", "android", "ios",
    "github", "google", "facebook", "microsoft", "apple", "gmail", "gatus",
    "gemini", "gemma", "livekit", "razorpay", "stripe", "vercel", "netlify",
    "cloudfront", "render", "webauthn", "passkey", "whisper", "aura",
    "iphone", "pro", "max", "gb",
}

ALL_CAPS_PROTECTED_TOKENS = {
    "OTP", "CVV", "GPS", "URL", "ID", "API", "KPI", "AWS", "SSM", "EC2",
    "HTTP", "HTTPS", "SMTP", "JSON", "HTML", "PNG", "JPG", "JPEG", "WEBP",
    "PDF", "CSV", "QR", "UI", "AI", "EMI", "COD", "UPI", "KYC", "MFA",
    "SMS", "FX", "PIN", "CAPS", "LOCK", "MM", "YY", "DD",
}

NON_LATIN_SCRIPT_BY_FLORES = {
    "hin_Deva": re.compile(r"[\u0900-\u097F]"),
    "mar_Deva": re.compile(r"[\u0900-\u097F]"),
    "san_Deva": re.compile(r"[\u0900-\u097F]"),
    "ben_Beng": re.compile(r"[\u0980-\u09FF]"),
    "asm_Beng": re.compile(r"[\u0980-\u09FF]"),
    "tel_Telu": re.compile(r"[\u0C00-\u0C7F]"),
    "urd_Arab": re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]"),
    "arb_Arab": re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]"),
    "guj_Gujr": re.compile(r"[\u0A80-\u0AFF]"),
    "pan_Guru": re.compile(r"[\u0A00-\u0A7F]"),
    "mal_Mlym": re.compile(r"[\u0D00-\u0D7F]"),
    "kan_Knda": re.compile(r"[\u0C80-\u0CFF]"),
    "ory_Orya": re.compile(r"[\u0B00-\u0B7F]"),
    "jpn_Jpan": re.compile(r"[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]"),
    "zho_Hans": re.compile(r"[\u4E00-\u9FFF]"),
}


def find_input_files(pattern):
    matches = sorted(glob.glob(f"/kaggle/input/**/{pattern}", recursive=True))
    if not matches:
        matches = sorted(glob.glob(pattern))
    return matches


def preload_cuda_libs_from_torch():
    """Ensure CTranslate2 can resolve CUDA 12 shared libs bundled alongside PyTorch."""
    try:
        import torch

        site_dir = os.path.dirname(os.path.dirname(torch.__file__))
        torch_lib = os.path.join(os.path.dirname(torch.__file__), "lib")
        lib_dirs = [torch_lib] + glob.glob(os.path.join(site_dir, "nvidia", "*", "lib"))
        extra = ":".join(d for d in lib_dirs if os.path.isdir(d))
        if extra:
            os.environ["LD_LIBRARY_PATH"] = (
                extra + ":" + os.environ.get("LD_LIBRARY_PATH", "")
            )
        for p in (
            glob.glob(os.path.join(site_dir, "nvidia", "*", "lib", "*.so*"))
            + glob.glob(os.path.join(torch_lib, "*.so*"))
        ):
            base = os.path.basename(p)
            if any(
                k in base
                for k in ("libcublas", "libcublasLt", "libcudart", "libnvrtc", "libcudnn")
            ):
                try:
                    ctypes.CDLL(p, mode=ctypes.RTLD_GLOBAL)
                except OSError:
                    pass
    except Exception as exc:
        print(f"CUDA library preload note: {exc}", flush=True)


def ensure_runtime_packages():
    missing = []
    for pkg, mod in (("ctranslate2", "ctranslate2"), ("sentencepiece", "sentencepiece")):
        try:
            __import__(mod)
        except ImportError:
            missing.append(pkg)

    if not missing:
        return

    whls = find_input_files("ctranslate2*.whl")
    if "ctranslate2" in missing and whls:
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "-q", "--no-index", "--no-deps", whls[0]]
        )
        missing = [m for m in missing if m != "ctranslate2"]

    if missing:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", *missing])


def resolve_ct2_model_dir():
    model_bins = find_input_files("model.bin")
    if model_bins:
        return os.path.dirname(model_bins[0])

    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "huggingface_hub"])
        from huggingface_hub import snapshot_download

    return snapshot_download(repo_id=DEFAULT_HF_REPO)


def needs_native_script_retry(item, candidate):
    rx = NON_LATIN_SCRIPT_BY_FLORES.get(item["floresCode"])
    if not rx:
        return False
    prose_src = SENTINEL_RE.sub(" ", item["maskedText"]).strip()
    if len(re.findall(r"[A-Za-z]", prose_src)) < 2:
        return False
    prose_out = SENTINEL_RE.sub(" ", candidate or "").strip()
    if not prose_out:
        return True
    native_cnt = len(rx.findall(prose_out))
    src_words = {w.lower() for w in re.findall(r"[A-Za-z]+", prose_src)}
    allowed_words = (src_words & NATIVE_SCRIPT_EXEMPT_SOURCE_WORDS) | ALL_CAPS_PROTECTED_TOKENS
    prose_cleaned = re.sub(r"\.[a-z0-9]{2,5}\b|\bms\b", " ", prose_out)
    non_exempt_latin = [
        w for w in re.findall(r"[A-Za-z]+", prose_cleaned)
        if w.lower() not in allowed_words and w not in ALL_CAPS_PROTECTED_TOKENS
    ]
    latin_cnt = sum(len(w) for w in non_exempt_latin)
    if native_cnt == 0 and latin_cnt >= 2:
        return True
    if native_cnt == 0 and any(len(w) >= 2 for w in re.findall(r"[A-Za-z]+", prose_cleaned)):
        return True
    total_cnt = native_cnt + latin_cnt
    if latin_cnt >= 4 and total_cnt > 0 and (latin_cnt / total_cnt) > 0.38:
        return True
    return False


def to_sentence_case_source(masked_text):
    parts = re.split(r"(\{v\d+\}|_\d+_)", masked_text)
    out = []
    seen_first = False
    for part in parts:
        if not part or re.fullmatch(r"\{v\d+\}|_\d+_", part):
            out.append(part)
            continue
        low = part.lower()
        if not seen_first and re.search(r"[a-z]", low):
            idx = re.search(r"[a-z]", low).start()
            low = low[:idx] + low[idx].upper() + low[idx + 1 :]
            seen_first = True
        out.append(low)
    return "".join(out)


def has_unk_chars(text):
    return bool(text and UNK_CHAR_RE.search(text))


def normalize_uppercase_prose(text):
    prose_only = SENTINEL_RE.sub(" ", text)
    if re.search(r"[a-z]{2,}", prose_only):
        return text
    upper_words = re.findall(r"\b[A-Z]{2,}\b", prose_only)
    if not upper_words:
        return text

    parts = re.split(r"(\{v\d+\}|[A-Za-z0-9_]+)", text)
    out = []
    seen_word = False
    for part in parts:
        if not part or SENTINEL_RE.fullmatch(part):
            out.append(part)
            continue
        if re.fullmatch(r"[A-Z]{2,}", part) and part not in ALL_CAPS_PROTECTED_TOKENS:
            w = part.lower()
            if not seen_word:
                w = w[0].upper() + w[1:]
                seen_word = True
            out.append(w)
        else:
            if re.search(r"[A-Za-z]{2,}", part):
                seen_word = True
            out.append(part)
    return "".join(out)


def normalize_curly_sentinels(text, expected_indices):
    if not text or has_unk_chars(text):
        return None
    out = text
    for idx in expected_indices:
        exact = f"{{v{idx}}}"
        loose = re.compile(rf"\{{\s*[vV]\s*{idx}\s*\}}")
        if exact in out:
            continue
        if loose.search(out):
            out = loose.sub(exact, out)
        else:
            return None
    found_all = [int(m) for m in LOOSE_CURLY_RE.findall(out)]
    if sorted(found_all) != sorted(expected_indices):
        return None
    if out.count("{") != len(expected_indices) or out.count("}") != len(expected_indices):
        return None
    for idx in expected_indices:
        if out.count(f"{{v{idx}}}") != expected_indices.count(idx):
            return None
    return out


def normalize_underscore_sentinels(text, expected_indices):
    if not text or has_unk_chars(text):
        return None
    out = text
    for idx in expected_indices:
        exact = f"_{idx}_"
        loose = re.compile(rf"_\s*{idx}\s*_")
        if exact in out:
            out = out.replace(exact, f"{{v{idx}}}")
        elif loose.search(out):
            out = loose.sub(f"{{v{idx}}}", out)
        else:
            return None
    if LOOSE_UNDERSCORE_RE.search(out):
        return None
    found_all = [int(m) for m in LOOSE_CURLY_RE.findall(out)]
    if sorted(found_all) != sorted(expected_indices):
        return None
    if out.count("{") != len(expected_indices) or out.count("}") != len(expected_indices):
        return None
    for idx in expected_indices:
        if out.count(f"{{v{idx}}}") != expected_indices.count(idx):
            return None
    return out


def decode_hypothesis(sp, tokens, target_lang):
    cleaned = [t for t in tokens if t != target_lang and t != "</s>"]
    return sp.decode(cleaned).strip()


def sanitize_clause_text(sp, text):
    src = DISAMBIGUATED_MT_SOURCES.get(text, text)
    src = src.replace("\u2013", "-")
    return normalize_uppercase_prose(src)


def has_sp_unk_tokens(sp, text):
    if not text:
        return False
    return sp.unk_id() in sp.encode(text, out_type=int)


def split_preserving_unk_chars(sp, text):
    """Split around '|', em-dash, and any char encoding to SentencePiece <unk>."""
    first_pass = re.split(r"(\s*\|\s*|\s*\u2014\s*)", text)
    parts = []
    unk_id = sp.unk_id()
    for piece in first_pass:
        if not piece:
            continue
        if re.fullmatch(r"\s*\|\s*|\s*\u2014\s*", piece):
            parts.append((False, piece))
            continue
        san = sanitize_clause_text(sp, piece)
        if not has_sp_unk_tokens(sp, san):
            parts.append((True, piece))
            continue
        # Isolate exact unknown non-whitespace characters cleanly while keeping {vN} intact
        for sub_chunk in re.split(r"(\{v\d+\})", piece):
            if not sub_chunk:
                continue
            if SENTINEL_RE.fullmatch(sub_chunk):
                parts.append((True, sub_chunk))
                continue
            buf = []
            for ch in sub_chunk:
                if not ch.isspace() and unk_id in sp.encode(sanitize_clause_text(sp, ch), out_type=int):
                    if buf:
                        parts.append((True, "".join(buf)))
                        buf = []
                    parts.append((False, ch))
                else:
                    buf.append(ch)
            if buf:
                parts.append((True, "".join(buf)))
    return parts


def translate_chunked(
    tr, sp, items, use_underscore=False, beam_size=1, normalize_case=False, is_cuda=True
):
    pairs = []
    for item in items:
        src = sanitize_clause_text(sp, item["maskedText"])
        if normalize_case:
            src = to_sentence_case_source(src)
        if use_underscore:
            src = SENTINEL_RE.sub(lambda m: f"_{m.group(1)}_", src)
        toks = ["eng_Latn"] + sp.encode(src, out_type=str) + ["</s>"]
        pairs.append((len(toks), item, toks))

    pairs.sort(key=lambda r: (r[0], r[1]["floresCode"]))
    results = {}
    chunk_size = 4096 if (is_cuda and beam_size == 1) else 512
    max_bs = 4096 if (is_cuda and beam_size == 1) else 1024

    for start in range(0, len(pairs), chunk_size):
        chunk = pairs[start : start + chunk_size]
        max_src = max(r[0] for r in chunk)
        dyn_len = min(144, max(24, max_src * 3 + 8)) if beam_size == 1 else 160
        outputs = tr.translate_batch(
            [r[2] for r in chunk],
            target_prefix=[[r[1]["floresCode"]] for r in chunk],
            beam_size=beam_size,
            batch_type="tokens",
            max_batch_size=max_bs,
            max_decoding_length=dyn_len,
            no_repeat_ngram_size=3,
            **SUPPRESS_KW,
        )
        for (_, item, _), res in zip(chunk, outputs):
            results[item["id"]] = decode_hypothesis(
                sp, res.hypotheses[0], item["floresCode"]
            )
    return results


def tier3_clause_translate_batch(tr, sp, items):
    if not items:
        return {}
    part_lists = []
    flat_toks = []
    flat_prefixes = []
    mapping = []
    for item in items:
        parts = re.split(r"(\{v\d+\}|[.;:]\s+)", item["maskedText"])
        part_lists.append(parts)
        use_low = item["floresCode"] in NON_LATIN_SCRIPT_BY_FLORES
        for pidx, part in enumerate(parts):
            if (
                not part
                or SENTINEL_RE.fullmatch(part)
                or re.fullmatch(r"[.;:]\s+", part)
                or not re.search(r"[A-Za-z]{2,}", part)
            ):
                continue
            clause = to_sentence_case_source(part.strip()) if use_low else part.strip()
            clause = sanitize_clause_text(sp, clause)
            toks = ["eng_Latn"] + sp.encode(clause, out_type=str) + ["</s>"]
            mapping.append((len(part_lists) - 1, pidx, item["floresCode"], part.strip()))
            flat_toks.append(toks)
            flat_prefixes.append([item["floresCode"]])
    if flat_toks:
        outputs = tr.translate_batch(
            flat_toks,
            target_prefix=flat_prefixes,
            beam_size=4,
            batch_type="tokens",
            max_batch_size=2048,
            max_decoding_length=128,
            no_repeat_ngram_size=3,
            **SUPPRESS_KW,
        )
        fallback_retry = []
        for (iidx, pidx, flores, raw_clause), res in zip(mapping, outputs):
            tr_part = decode_hypothesis(sp, res.hypotheses[0], flores)
            parts = part_lists[iidx]
            lead = " " if parts[pidx].startswith(" ") else ""
            trail = " " if parts[pidx].endswith(" ") else ""
            bad_script = needs_native_script_retry(
                {"floresCode": flores, "maskedText": raw_clause}, tr_part
            )
            if tr_part and not has_unk_chars(tr_part) and not bad_script:
                safe_part = tr_part.replace("{", "").replace("}", "")
                parts[pidx] = f"{lead}{safe_part}{trail}"
            else:
                fallback_retry.append((iidx, pidx, flores, raw_clause))

        if fallback_retry:
            fb_toks = []
            fb_prefixes = []
            for (_, _, _, raw_clause) in fallback_retry:
                forced = sanitize_clause_text(sp, raw_clause).lower().rstrip(".") + "."
                fb_toks.append(["eng_Latn"] + sp.encode(forced, out_type=str) + ["</s>"])
            fb_prefixes = [[flores] for (_, _, flores, _) in fallback_retry]
            fb_outputs = tr.translate_batch(
                fb_toks,
                target_prefix=fb_prefixes,
                beam_size=5,
                batch_type="tokens",
                max_batch_size=1024,
                max_decoding_length=128,
                no_repeat_ngram_size=3,
                repetition_penalty=1.15,
                **SUPPRESS_KW,
            )
            for (iidx, pidx, flores, raw_clause), res in zip(fallback_retry, fb_outputs):
                tr_part = decode_hypothesis(sp, res.hypotheses[0], flores)
                parts = part_lists[iidx]
                lead = " " if parts[pidx].startswith(" ") else ""
                trail = " " if parts[pidx].endswith(" ") else ""
                cleaned = UNK_CHAR_RE.sub("", tr_part).strip()
                if not raw_clause.rstrip().endswith("."):
                    cleaned = re.sub(r"[。.]+$", "", cleaned).strip()
                cleaned = cleaned.replace("{", "").replace("}", "")
                if cleaned and not needs_native_script_retry(
                    {"floresCode": flores, "maskedText": raw_clause}, cleaned
                ):
                    parts[pidx] = f"{lead}{cleaned}{trail}"
                else:
                    print(
                        f"Tier3 fallback kept source [{flores}] {raw_clause!r} -> {tr_part!r}",
                        flush=True,
                    )
    return {
        item["id"]: re.sub(r"\s{2,}", " ", "".join(parts)).strip()
        for item, parts in zip(items, part_lists)
    }


def execute_mt_tiers(tr, sp, mt_items, is_cuda=True):
    """Run Tier 1 (beam=1) -> Tier 2 (_N_, beam=4) -> Tier 3 (clause isolation) with strict <unk> & sentinel validation."""
    resolved = {}
    if not mt_items:
        return resolved

    tier1_raw = translate_chunked(
        tr, sp, mt_items, use_underscore=False, beam_size=1, is_cuda=is_cuda
    )
    tier2_retries = []
    for item in mt_items:
        expected = [int(m) for m in SENTINEL_RE.findall(item["maskedText"])]
        out_raw = tier1_raw.get(item["id"], "")
        force_case_retry = (
            normalize_uppercase_prose(item["maskedText"]) != item["maskedText"]
        )
        if not expected:
            if (
                has_unk_chars(out_raw)
                or needs_native_script_retry(item, out_raw)
                or not out_raw.strip()
            ):
                tier2_retries.append(item)
            else:
                resolved[item["id"]] = out_raw
        else:
            norm = normalize_curly_sentinels(out_raw, expected)
            if (
                norm is not None
                and not force_case_retry
                and not needs_native_script_retry(item, norm)
            ):
                resolved[item["id"]] = norm
            else:
                tier2_retries.append(item)

    if tier2_retries:
        print(f"Tier 2 beam=4 recovery on {len(tier2_retries)} items...", flush=True)
        tier2_raw = translate_chunked(
            tr,
            sp,
            tier2_retries,
            use_underscore=True,
            beam_size=4,
            normalize_case=True,
            is_cuda=is_cuda,
        )
        tier3_items = []
        for item in tier2_retries:
            expected = [int(m) for m in SENTINEL_RE.findall(item["maskedText"])]
            raw2 = tier2_raw.get(item["id"], "")
            norm = (
                normalize_underscore_sentinels(raw2, expected)
                if expected
                else (None if has_unk_chars(raw2) else raw2)
            )
            if norm is not None and norm.strip() and not needs_native_script_retry(item, norm):
                resolved[item["id"]] = norm
            else:
                tier3_items.append(item)
        if tier3_items:
            print(f"Tier 3 clause recovery on {len(tier3_items)} items...", flush=True)
            t3_out = tier3_clause_translate_batch(tr, sp, tier3_items)
            for item in tier3_items:
                resolved[item["id"]] = t3_out.get(item["id"]) or item["maskedText"]
    return resolved


def main():
    t0 = time.time()
    tasks_files = find_input_files("repair_tasks.json")
    if not tasks_files:
        raise FileNotFoundError("Could not locate repair_tasks.json in /kaggle/input or cwd")

    tasks_path = tasks_files[0]
    ckpt_files = find_input_files("*repair_results.json.jsonl")
    out_dir = "/kaggle/working" if os.path.isdir("/kaggle/working") else "."
    out_json = os.path.join(out_dir, "repair_results.json")

    with open(tasks_path, "r", encoding="utf-8") as f:
        tasks = json.load(f)["tasks"]
    tasks_by_id = {t["id"]: t for t in tasks}

    completed = {}
    use_ckpt = len(tasks) > 2000 or os.environ.get("AURA_USE_CHECKPOINT") == "1"
    for ckpt in (ckpt_files if use_ckpt else []):
        with open(ckpt, "r", encoding="utf-8") as cf:
            for line in cf:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                tid = rec.get("id")
                txt = rec.get("translatedText")
                task = tasks_by_id.get(tid)
                if not task or not isinstance(txt, str) or not txt.strip() or has_unk_chars(txt):
                    continue
                src_raw = task["maskedText"]
                if (
                    src_raw in DISAMBIGUATED_MT_SOURCES
                    or normalize_uppercase_prose(src_raw) != src_raw
                    or "|" in src_raw
                    or "\u2014" in src_raw
                    or "\u2013" in src_raw
                ):
                    continue
                if STRICT_VERBATIM_RE.match(src_raw.strip()):
                    completed[tid] = src_raw.strip()
                    continue
                expected = [int(m) for m in SENTINEL_RE.findall(task["maskedText"])]
                if expected:
                    norm_ckpt = normalize_curly_sentinels(txt, expected)
                    if norm_ckpt is None:
                        continue
                    txt = norm_ckpt
                if needs_native_script_retry(task, txt):
                    continue
                completed[tid] = txt

    all_pending = [t for t in tasks if t["id"] not in completed]
    shard_index = int(os.environ.get("AURA_SHARD_INDEX", "0"))
    shard_count = max(1, int(os.environ.get("AURA_SHARD_COUNT", "1")))
    pending = (
        [t for idx, t in enumerate(all_pending) if idx % shard_count == shard_index]
        if shard_count > 1
        else all_pending
    )
    print(
        f"Tasks={len(tasks)}, checkpointed={len(completed)}, shard={shard_index}/{shard_count}, pending={len(pending)}",
        flush=True,
    )

    if pending:
        preload_cuda_libs_from_torch()
        ensure_runtime_packages()
        model_dir = resolve_ct2_model_dir()

        import ctranslate2
        import sentencepiece as spm

        sp = spm.SentencePieceProcessor(
            model_file=os.path.join(model_dir, "sentencepiece.bpe.model")
        )
        unk_piece = sp.id_to_piece(sp.unk_id())
        suppress_seqs = [[unk_piece]]
        for idx in range(sp.get_piece_size()):
            piece = sp.id_to_piece(idx)
            if piece != unk_piece and ("??" in piece or "\u2047" in piece or "\ufffd" in piece):
                suppress_seqs.append([piece])
        print(f"Prepared {len(suppress_seqs)} CT2 suppress_sequences", flush=True)

        def probe_translator(cand):
            test_tok = ["eng_Latn"] + sp.encode("Hello", out_type=str) + ["</s>"]
            try:
                cand.translate_batch(
                    [test_tok],
                    target_prefix=[["hin_Deva"]],
                    max_decoding_length=16,
                    suppress_sequences=suppress_seqs,
                )
                SUPPRESS_KW["suppress_sequences"] = suppress_seqs
                return
            except TypeError:
                pass
            cand.translate_batch(
                [test_tok], target_prefix=[["hin_Deva"]], max_decoding_length=16
            )

        cuda_count = ctranslate2.get_cuda_device_count()
        print(f"CT2 CUDA count={cuda_count}, model_dir={model_dir}", flush=True)

        tr = None
        is_cuda = False
        if cuda_count > 0:
            for ct in ("int8_float16", "int8_float32", "int8", "float32"):
                try:
                    cand = ctranslate2.Translator(model_dir, device="cuda", compute_type=ct)
                    probe_translator(cand)
                    tr = cand
                    is_cuda = True
                    print(f"Using CUDA CT2 compute_type={ct}", flush=True)
                    break
                except Exception as exc:
                    print(f"CUDA CT2 {ct} failed: {exc}", flush=True)
        if tr is None:
            print("Using Kaggle CPU int8 fallback", flush=True)
            tr = ctranslate2.Translator(
                model_dir, device="cpu", compute_type="int8", inter_threads=4, intra_threads=1
            )
            probe_translator(tr)

        plain_items = []
        delim_plans = []
        delim_sub_items = []

        for item in pending:
            src_raw = item["maskedText"]
            if STRICT_VERBATIM_RE.match(src_raw.strip()):
                completed[item["id"]] = src_raw.strip()
                continue
            sanitized = sanitize_clause_text(sp, src_raw)
            if "|" in src_raw or "\u2014" in src_raw or has_sp_unk_tokens(sp, sanitized):
                parts = split_preserving_unk_chars(sp, src_raw)
                plan_slots = []
                for sidx, (is_translatable, piece) in enumerate(parts):
                    if not is_translatable or not re.search(r"[A-Za-z]{2,}", SENTINEL_RE.sub(" ", piece)):
                        plan_slots.append((None, piece))
                        continue
                    sub_id = f"{item['id']}__sub__{sidx}"
                    lead = " " if piece.startswith(" ") else ""
                    trail = " " if piece.endswith(" ") else ""
                    delim_sub_items.append({
                        "id": sub_id,
                        "floresCode": item["floresCode"],
                        "maskedText": piece.strip(),
                    })
                    plan_slots.append((sub_id, (lead, trail)))
                delim_plans.append((item["id"], plan_slots))
            else:
                plain_items.append(item)

        mt_resolved = execute_mt_tiers(tr, sp, plain_items + delim_sub_items, is_cuda=is_cuda)
        for item in plain_items:
            if item["id"] in mt_resolved:
                completed[item["id"]] = mt_resolved[item["id"]]
        for orig_id, plan_slots in delim_plans:
            rebuilt = []
            for sub_id, meta in plan_slots:
                if sub_id is None:
                    rebuilt.append(meta)
                else:
                    lead, trail = meta
                    rebuilt.append(f"{lead}{mt_resolved.get(sub_id, '')}{trail}")
            joined = re.sub(r"\s{2,}", " ", "".join(rebuilt)).strip()
            completed[orig_id] = joined or tasks_by_id[orig_id]["maskedText"]

    if shard_count > 1:
        assigned_ids = {t["id"] for t in pending}
        final_records = [
            {"id": t["id"], "translatedText": completed[t["id"]]}
            for t in tasks
            if t["id"] in completed
        ]
        for t in pending:
            if t["id"] in assigned_ids and t["id"] not in completed:
                final_records.append({"id": t["id"], "translatedText": t["maskedText"]})
    else:
        final_records = [
            {"id": t["id"], "translatedText": completed.get(t["id"], t["maskedText"])}
            for t in tasks
        ]
    with open(out_json, "w", encoding="utf-8") as out_f:
        json.dump(final_records, out_f, ensure_ascii=False)
    print(f"Wrote {len(final_records)} segments -> {out_json} in {time.time() - t0:.2f}s", flush=True)


if __name__ == "__main__":
    main()
