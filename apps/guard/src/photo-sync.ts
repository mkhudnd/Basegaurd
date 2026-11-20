export type QueuedPhoto = {id:string; incident_id:string; uri:string};
export type PhotoSyncAdapter = {
  pending: () => Promise<QueuedPhoto[]>;
  uploading: (id:string) => Promise<void>;
  send: (photo:QueuedPhoto) => Promise<void>;
  uploaded: (id:string) => Promise<void>;
  failed: (id:string,message:string) => Promise<void>;
  notify: () => Promise<void>;
};

export async function syncPhotos(adapter:PhotoSyncAdapter):Promise<{sent:number;failed:number}> {
  let sent=0,failed=0;
  for(const photo of await adapter.pending()){
    await adapter.uploading(photo.id);
    await adapter.notify();
    try {
      await adapter.send(photo);
      await adapter.uploaded(photo.id);
      sent++;
    } catch(error) {
      await adapter.failed(photo.id,(error instanceof Error?error.message:'Photo upload failed').slice(0,250));
      failed++;
    }
    await adapter.notify();
  }
  return {sent,failed};
}
