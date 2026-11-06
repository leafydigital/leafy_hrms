# Leafy HRMS — Chat: WhatsApp-style bubbles, file & image sharing, private groups

Copy the files over your two projects (same paths), then:

```powershell
cd Backend
npm run db:migrate        # applies 008_chat_groups_files.sql (safe to re-run)
```
Restart the API. No new npm packages.

## Files
| File | Change |
|---|---|
| `Backend/db/migrations/008_chat_groups_files.sql` | **New.** Private groups (`chat_channels.kind = 'group'`, `created_by`), member roles (`owner`/`member`, `added_by`, `added_at`), text can be empty when a file is sent, new `chat_attachments` table (files stored in PostgreSQL) |
| `Backend/src/chat.js` | Upload (`POST /api/chat/upload`), download (`GET /api/chat/file/:id`), send with `attachment_ids`, groups: `/groups/create`, `/groups/members`, `/groups/add`, `/groups/remove` (also leave), `/groups/update`, `/groups/delete` |
| `Frontend/src/hrms/pages/Chat.jsx` | WhatsApp-style layout, attachments (pick, paste, drag & drop), Groups section, create group, group info |
| `Frontend/src/hrms/lib/db.js` | `apiUpload()` (raw upload with progress) and `apiBlob()` (download with the login token) |
| `Frontend/src/hrms/lib/realtime.jsx` | Refreshes the chat list when you are added to or removed from a group; pop-ups show "📎 file name" for file-only messages |

## How it behaves
- **Your messages are on the right in green bubbles; others' are on the left in white**, with their name (in channels and groups) and avatar. Times are inside the bubble. "X created the group / added Y" shows as a small note in the middle.
- **Files:** 📎 button, **Ctrl+V to paste a screenshot**, or drag files onto the chat. They upload straight away (progress shown) and go out when you press Send. Text is optional.
  - Up to **10 MB per file**, 10 files per message.
  - Images show as pictures; click one for a full view and download. Other files show as a card; click to download.
  - Programs and scripts (.exe, .bat, .js, .html, .svg …) are refused.
- **Groups:** *Create a group* (people icon or **+** next to "Groups") → name, optional description, tick the people. **Only those people see the group** and its messages and files. The creator is the owner. The owner, Admin or HR can rename it, add or remove people, or delete it. Anyone can leave. If the owner leaves, the longest-standing member becomes owner. People get a pop-up when added.
- #general, #shift-updates and #task-updates stay open to everyone. Direct messages are unchanged.

## Notes
- Files are kept in the database (`chat_attachments.data`). That's fine for a small team. If storage grows large, they can be moved to S3 later without changing the screens.
- Files someone uploads but never sends are deleted automatically after a day.
- **If you use Nginx** in front of the API, allow uploads of 10 MB: `client_max_body_size 12m;` in the `server { }` block.
