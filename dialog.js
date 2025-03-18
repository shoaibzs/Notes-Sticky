/**
 * Name:      Notes (sticky) Extension for GNOME
 *            This file provides a custom modal dialog for the notes extension.
 *            It's used for confirmation dialogs like delete confirmation and title editing.
 * Version:   1.0
 * Created:   17.03.2025
 * URL:       https://github.com/shoaibzs/
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

'use strict';

// Import GNOME libraries
import St from 'gi://St';
import * as Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import * as Gio from 'gi://Gio';
import * as Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

// Import our own modules
import * as NoteBox from './noteBox.js';

/**
 * Dialog class
 * 
 * Handles the creation and management of dialogs for note operations.
 */
class Dialog {
	/**
	 * Create a new dialog
	 * 
	 * @param {string} title - Dialog title
	 * @param {string} message - Dialog message
	 * @param {string} buttonText - Text for the confirm button
	 * @returns {ModalDialog} - The created dialog
	 */
	static create(title, message, buttonText) {
		const dialog = new ModalDialog.ModalDialog();
		dialog.title = title;
		
		// Create message label
		const messageLabel = new St.Label({
			text: message,
			style: 'text-align: center; padding: 10px;'
		});
		dialog.contentLayout.add_child(messageLabel);
		
		dialog.addButton({
			label: buttonText,
			action: () => {
				dialog.close();
			},
			key: 0
		});
		return dialog;
	}

	/**
	 * Show a confirmation dialog
	 * 
	 * @param {string} title - Dialog title
	 * @param {string} message - Dialog message
	 * @param {Function} callback - Function to call when confirmed
	 */
	static showConfirm(title, message, callback) {
		const dialog = new ModalDialog.ModalDialog();
		dialog.title = title;
		
		// Create message label
		const messageLabel = new St.Label({
			text: message,
			style: 'text-align: center; padding: 10px;'
		});
		dialog.contentLayout.add_child(messageLabel);
		
		dialog.addButton({
			label: "Cancel",
			action: () => {
				dialog.close();
			},
			key: 0
		});
		dialog.addButton({
			label: "Confirm",
			action: () => {
				callback();
				dialog.close();
			},
			key: 1
		});
		dialog.open();
	}

	/**
	 * Show an error dialog
	 * 
	 * @param {string} message - Error message
	 */
	static showError(message) {
		const dialog = new ModalDialog.ModalDialog();
		dialog.title = "Error";
		
		// Create message label
		const messageLabel = new St.Label({
			text: message,
			style: 'text-align: center; padding: 10px;'
		});
		dialog.contentLayout.add_child(messageLabel);
		
		dialog.addButton({
			label: "OK",
			action: () => {
				dialog.close();
			},
			key: 0
		});
		dialog.open();
	}
}

export default Dialog;

