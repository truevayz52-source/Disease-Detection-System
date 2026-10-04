import fs from 'node:fs'
for(const file of ['pages/workflows.tsx','pages/operations.tsx','pages/user-profile.tsx','pages/notifications-center.tsx','components/comment-thread.tsx','components/notification-bell.tsx']){
  const path=`client/src/${file}`
  const s=fs.readFileSync(path,'utf8').replaceAll('useSWR(', 'useSWR<any>(')
  fs.writeFileSync(path,s)
}
