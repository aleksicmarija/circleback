{ pkgs ? import <nixpkgs> {} }:

# Plain mkShell puts nodejs_22 on PATH, but tools that download prebuilt
# native binaries at runtime (notably `npx convex dev`, which fetches a
# dynamically-linked binary) fail on NixOS: there's no /lib64/ld-linux.so.2
# or standard FHS layout for the dynamic linker to find. buildFHSUserEnv's
# `.env` gives nix-shell an FHS-compatible sandbox instead, so those
# binaries run unmodified.
(pkgs.buildFHSEnv {
  name = "circleback-shell";
  targetPkgs = pkgs: with pkgs; [
    nodejs_22
  ];
  profile = ''
    export NODE_ENV=development
  '';
}).env
