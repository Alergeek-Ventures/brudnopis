{ pkgs, lib, config, ... }:

let
  loaderArgs = "--library-path ${lib.makeLibraryPath [ pkgs.stdenv.cc.cc ]}";
  dynamicLinker = pkgs.stdenv.cc.bintools.dynamicLinker;

  projectRoot = ''
    project_root="''${DEVENV_ROOT:-}"
    if [ -z "$project_root" ]; then
      project_root="$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null || pwd)"
    fi
  '';

  biomeWrapper = pkgs.writeShellScriptBin "biome-loader" ''
    set -euo pipefail
    ${projectRoot}
    binaries=( "$project_root"/node_modules/@biomejs/cli-linux-*/biome )
    if [ "''${#binaries[@]}" -ne 1 ] || [ ! -x "''${binaries[0]}" ]; then
      printf '%s\n' "Biome is not installed for this project. Run: pnpm install" >&2
      exit 1
    fi
    exec ${dynamicLinker} ${loaderArgs} "''${binaries[0]}" "$@"
  '';

  astGrepWrapper = pkgs.writeShellScriptBin "ast-grep-loader" ''
    set -euo pipefail
    ${projectRoot}
    binary="$project_root/node_modules/@ast-grep/cli/ast-grep"
    if [ ! -x "$binary" ]; then
      printf '%s\n' "ast-grep is not installed for this project. Run: pnpm install" >&2
      exit 1
    fi
    exec ${dynamicLinker} ${loaderArgs} "$binary" "$@"
  '';
in
{
  languages.javascript.enable = true;
  languages.javascript.package = pkgs.nodejs_24;
  languages.javascript.pnpm.enable = true;
  languages.javascript.pnpm.package = pkgs.pnpm_10;

  packages = [ pkgs.jdk17 biomeWrapper astGrepWrapper ];

  android = {
    enable = true;
    platforms.version = [ "36" ];
    buildTools.version = [ "36.0.0" "35.0.0" ];
    ndk.version = [ "27.1.12297006" ];
    emulator.enable = false;
    systemImages.enable = false;
  };

  languages.java.jdk.package = pkgs.jdk17;

  env.ANDROID_SDK_ROOT = config.env.ANDROID_HOME;
  env.BIOME_BINARY = "${biomeWrapper}/bin/biome-loader";
  env.AST_GREP_BINARY = "${astGrepWrapper}/bin/ast-grep-loader";

  enterTest = ''
    pnpm lint
    pnpm exec tsc --noEmit
    pnpm test --run
  '';
}
