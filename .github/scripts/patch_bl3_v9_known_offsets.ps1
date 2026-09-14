$ErrorActionPreference = 'Stop'

$path = "Source\Games\Unreal Engine\main.cpp"
$text = Get-Content -Path $path -Raw

$helper = @'

   // Borderlands 3 build-specific CVar access for the user's executable.
   // SHA-256: 923afd263631681aff88037add504bf353fc6f4caa9045cfdb709e049fe4f101
   // PE TimeDateStamp: 0x66AC5CD4, SizeOfImage: 0x07258000
   // Static initialization analysis found the TConsoleVariableData pointers at:
   //   r.TemporalAA.Upsampling -> module + 0x06B09AE0 (int32_t**)
   //   r.ScreenPercentage      -> module + 0x068B3288 (float**)
   static bool bl3_known_cvars_validation_done = false;
   static bool bl3_known_cvars_valid_exe = false;
   static bool bl3_known_cvars_logged = false;
   static bool bl3_known_cvars_error_logged = false;

   static bool BL3ValidateKnownExecutable(uint8_t* base)
   {
      if (base == nullptr)
         return false;

      auto* dos = reinterpret_cast<IMAGE_DOS_HEADER*>(base);
      if (dos->e_magic != IMAGE_DOS_SIGNATURE)
         return false;

      auto* nt = reinterpret_cast<IMAGE_NT_HEADERS64*>(base + dos->e_lfanew);
      if (nt->Signature != IMAGE_NT_SIGNATURE)
         return false;

      return nt->FileHeader.TimeDateStamp == 0x66AC5CD4u &&
             nt->OptionalHeader.SizeOfImage == 0x07258000u;
   }

   static void BL3ForceKnownCVars85()
   {
      auto* base = reinterpret_cast<uint8_t*>(GetModuleHandleW(nullptr));
      if (base == nullptr)
         return;

      if (!bl3_known_cvars_validation_done)
      {
         bl3_known_cvars_valid_exe = BL3ValidateKnownExecutable(base);
         bl3_known_cvars_validation_done = true;

         if (!bl3_known_cvars_valid_exe)
         {
            reshade::log::message(reshade::log::level::warning,
               "[Luma] BL3 v9: Executable version mismatch; automatic TAAU/ScreenPercentage forcing disabled.");
         }
      }

      if (!bl3_known_cvars_valid_exe)
         return;

      auto** temporal_slot = reinterpret_cast<int32_t**>(base + 0x06B09AE0ull);
      auto** screen_slot = reinterpret_cast<float**>(base + 0x068B3288ull);

      if (!BL3MemoryWritable(temporal_slot, sizeof(*temporal_slot)) ||
          !BL3MemoryWritable(screen_slot, sizeof(*screen_slot)))
      {
         if (!bl3_known_cvars_error_logged)
         {
            bl3_known_cvars_error_logged = true;
            reshade::log::message(reshade::log::level::warning,
               "[Luma] BL3 v9: CVar pointer slots are not writable yet.");
         }
         return;
      }

      int32_t* temporal = *temporal_slot;
      float* screen = *screen_slot;

      if (temporal == nullptr || screen == nullptr ||
          !BL3MemoryWritable(temporal, sizeof(int32_t) * 2) ||
          !BL3MemoryWritable(screen, sizeof(float) * 2))
      {
         return;
      }

      // TConsoleVariableData keeps game-thread and render-thread shadow values.
      temporal[0] = 1;
      temporal[1] = 1;
      screen[0] = 85.0f;
      screen[1] = 85.0f;

      if (!bl3_known_cvars_logged)
      {
         bl3_known_cvars_logged = true;
         reshade::log::message(reshade::log::level::info,
            "[Luma] BL3 v9: Forced r.TemporalAA.Upsampling=1 and r.ScreenPercentage=85 using verified executable offsets.");
      }
   }
'@

$namespaceEndPattern = '\}\s*// namespace\s*\r?\n\s*\r?\nstruct GameDeviceDataUnrealEngine'
$namespaceEndReplacement = $helper + "`r`n} // namespace`r`n`r`nstruct GameDeviceDataUnrealEngine"
$patched = [regex]::Replace($text, $namespaceEndPattern, $namespaceEndReplacement, 1)
if ($patched -eq $text) { throw "Could not insert BL3 v9 known-offset helper." }
$text = $patched

# Disable the older heuristic runtime scanner and use exact offsets from the uploaded executable.
$presentPattern = 'BL3ForceTemporalUpsampling\(\);'
$presentReplacement = 'BL3ForceKnownCVars85();'
$patched = [regex]::Replace($text, $presentPattern, $presentReplacement, 1)
if ($patched -eq $text) { throw "Could not replace heuristic TAAU forcing call with BL3 v9 known-offset forcing." }
$text = $patched

Set-Content -Path $path -Value $text -Encoding utf8 -NoNewline
Write-Host "Added BL3 v9 exact CVar forcing for TAAU=1 and ScreenPercentage=85."
Select-String -Path $path -Pattern "BL3ForceKnownCVars85|06B09AE0|068B3288|ScreenPercentage=85" -Context 1,3
