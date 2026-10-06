# App Control for Business (WDAC): AUDIT ONLY in v1

**What it is:** a Windows feature that decides which programs may run *at all*, enforced by the OS kernel. That's much stronger than our process watcher, which closes programs *after* they start.

**Why audit only:** an enforced policy with a mistake can make a PC **unbootable** or block the admin. So in v1 we only collect information: in audit mode Windows **logs** what it *would* block and blocks nothing.

**Windows 11 Home:** per Microsoft, App Control policies are *enforced* on all editions, but the PowerShell cmdlets to **create** policies (`New-CIPolicy`, `ConvertFrom-CIPolicy`, …) aren't on Home. So you **build the policy on a Windows Pro/Enterprise PC or VM** and copy the result to the visitor PCs.

> ⚠️ Everything below is **VERIFY + UNTESTED(windows)**. Check each command in Microsoft Learn ("App Control for Business") before running it, and test on one PC you can reinstall.

## Plan (do not skip steps)
1. **On a Pro/Enterprise machine:** start from Microsoft's example policy `DefaultWindows_Audit.xml`, in `C:\Windows\schemas\CodeIntegrity\ExamplePolicies\`. It allows Windows itself and is already in **audit** mode. Copy it; don't edit the original.
2. Add rules for our programs: Node.js (`C:\Program Files\nodejs`), the kiosk shell (`C:\Program Files\Stillgate`), and each allow-listed app. Use the Microsoft docs to add file-path or publisher rules to the copy.
3. Convert the XML to the binary form (`ConvertFrom-CIPolicy`) and give it the policy's GUID as its file name.
4. **On one visitor PC:** copy the binary to the active-policies folder named in the Microsoft docs, then activate it (on Windows 11: `CiTool --update-policy <file>`; check that `CiTool` exists on Home first).
5. **Collect audit events for at least one week** (Event Viewer → Applications and Services Logs → Microsoft → Windows → CodeIntegrity → Operational). Every event is something that *would* have been blocked.
6. Fix the policy until a normal week produces **no** unexpected audit events.
7. **Only then**, as a separate, clearly-labelled later project: an enforced policy. Never enforce without a tested way back (keep the admin account and the recovery steps in `docs/RECOVERY.md` ready, and keep an unenforced copy).

## Not in this repo on purpose
No policy XML is committed. A wrong policy is dangerous, so it must be built from Microsoft's own template, on your hardware, with your app list.
