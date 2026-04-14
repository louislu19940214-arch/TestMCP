# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Cocos Creator 3.8.8 game project. Cocos Creator is a game development engine that uses TypeScript for game logic.

## Project Structure

- `assets/` - Game assets (scenes, scripts, prefabs, textures, audio, etc.). Currently empty in this new project.
- `library/` - Asset imports and compiled data (auto-generated, do not modify).
- `temp/` - Temporary build files and TypeScript declarations (auto-generated).
- `settings/` - Project and editor settings.
- `profiles/` - Editor profiles and preferences.
- `tsconfig.json` - TypeScript configuration, extends `temp/tsconfig.cocos.json`.

## TypeScript Configuration

TypeScript config extends `./temp/tsconfig.cocos.json` which includes:
- Target: ES2015
- Strict mode enabled (overridden to false in project's tsconfig.json)
- Decorators enabled
- Path aliases: `db://assets/*` maps to `assets/*`

## Enabled Engine Modules

Based on builder.json configuration, this project includes:
- 2D rendering, UI components, masks, graphics
- Animation, tween system
- 2D physics (Box2D)
- Particle system (2D)
- Audio, video, webview
- Spine 3.8, DragonBones animation
- Tiled map support
- Custom render pipeline

## Development Workflow

Game scripts should be placed in `assets/` directory with `.ts` extension. The Cocos Creator editor provides:
- Scene editor for visual layout
- Component-based architecture
- Hot reload for script changes
- Build system for web, iOS, Android, and other platforms

## Building

Use the Cocos Creator editor to build projects for different platforms. The editor handles:
- Asset optimization
- Code compilation
- Platform-specific packaging
